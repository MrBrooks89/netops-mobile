import Foundation
import Security

/**
 * TLS chain capture for iOS (M6 parity, M8 implementation; plan #42, §16.7).
 *
 * The Android half records the chain with a capture-only `X509TrustManager`.
 * iOS needs no such thing and gets something better: a `URLSession` delegate
 * sees the server trust challenge and can **record** the presented chain while
 * still calling `performDefaultHandling` — so the system keeps deciding whether
 * the certificate is trusted. There is no validation bypass anywhere in this
 * file or this module (§16.7); an untrusted certificate simply fails the
 * request *after* its chain has been captured for display.
 *
 * Honest mapping notes:
 *  - Subject uses `SecCertificateCopySubjectSummary`; issuer is assembled from
 *    the parsed issuer RDNs, because iOS has no single "issuer display name".
 *  - `selfSigned` compares the DER-normalised subject and issuer sequences
 *    rather than the display strings, so it cannot be fooled by formatting.
 *  - TLS version and cipher are mapped from the IANA numbers in the task
 *    metrics, so this file never depends on enum-case spellings.
 *  - Version/cipher/handshake timing only exist when the handshake completes;
 *    a failed request still reports the captured chain plus the error.
 */
enum TlsCapture {
  static func capture(host: String, port: Int, timeoutMs: Int, completion: @escaping ([String: Any]) -> Void) {
    guard let url = URL(string: "https://\(host):\(port)/") else {
      completion(errorResult(host: host, port: port, message: "Invalid host"))
      return
    }

    let seconds = Double(max(500, timeoutMs)) / 1000.0
    var request = URLRequest(url: url)
    // A handshake is all we need; HEAD keeps the response cheap on a real
    // HTTP server, and on a non-HTTP TLS port the request fails after the
    // handshake — by which time the chain is already captured.
    request.httpMethod = "HEAD"
    request.timeoutInterval = seconds

    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = seconds
    configuration.timeoutIntervalForResource = seconds
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.urlCache = nil

    let collector = TlsCollector(host: host, port: port, completion: completion)
    let session = URLSession(configuration: configuration, delegate: collector, delegateQueue: nil)
    collector.session = session
    let task = session.dataTask(with: request)
    task.resume()
  }

  private static func errorResult(host: String, port: Int, message: String) -> [String: Any] {
    [
      "host": host,
      "port": port,
      "chain": [],
      "tlsVersion": NSNull(),
      "cipherSuite": NSNull(),
      "error": message,
    ]
  }
}

/** Session delegate that records what the server presents and finishes once. */
final class TlsCollector: NSObject, URLSessionDataDelegate {
  private let host: String
  private let port: Int
  private let completion: ([String: Any]) -> Void

  private var chain: [SecCertificate] = []
  private var tlsVersion: String?
  private var cipherSuite: String?
  private var handshakeMs: Int?
  private var errorMessage: String?
  private var finished = false

  var session: URLSession?

  init(host: String, port: Int, completion: @escaping ([String: Any]) -> Void) {
    self.host = host
    self.port = port
    self.completion = completion
    super.init()
  }

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
      let trust = challenge.protectionSpace.serverTrust
    {
      chain = certificates(from: trust)
    }
    // Record, then let the system decide — no bypass.
    completionHandler(.performDefaultHandling, nil)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didFinishCollecting metrics: URLSessionTaskMetrics
  ) {
    guard let transaction = metrics.transactionMetrics.last else { return }
    if let version = transaction.negotiatedTLSProtocolVersion {
      tlsVersion = TlsNaming.version(version)
    }
    if let suite = transaction.negotiatedTLSCipherSuite {
      cipherSuite = TlsNaming.cipherSuite(suite)
    }
    if let secureStart = transaction.secureConnectionStartDate,
      let connected = transaction.connectEndDate
    {
      handshakeMs = Int((connected.timeIntervalSince(secureStart) * 1000).rounded())
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error {
      errorMessage = error.localizedDescription
    }
    finish()
  }

  private func finish() {
    guard !finished else { return }
    finished = true
    session?.finishTasksAndInvalidate()
    session = nil

    var result: [String: Any] = [
      "host": host,
      "port": port,
      "chain": chain.enumerated().map { index, certificate in
        TlsCertificateInfo.describe(certificate, position: index)
      },
      "tlsVersion": tlsVersion ?? NSNull(),
      "cipherSuite": cipherSuite ?? NSNull(),
    ]
    if let handshakeMs {
      result["handshakeMs"] = handshakeMs
    }
    if let errorMessage {
      result["error"] = errorMessage
    }
    completion(result)
  }

  private func certificates(from trust: SecTrust) -> [SecCertificate] {
    guard let certificates = SecTrustCopyCertificateChain(trust) as? [SecCertificate] else {
      return []
    }
    return certificates
  }
}

/** Maps one `SecCertificate` onto the JSON shape the Android half produces. */
enum TlsCertificateInfo {
  static func describe(_ certificate: SecCertificate, position: Int) -> [String: Any] {
    let subject = SecCertificateCopySubjectSummary(certificate) as String? ?? ""
    let issuer = name(certificate, oid: kSecOIDX509V1IssuerName)
    return [
      "subject": subject,
      "issuer": issuer,
      "sans": sans(certificate),
      "notBefore": iso8601(date(certificate, oid: kSecOIDX509V1ValidityNotBefore)),
      "notAfter": iso8601(date(certificate, oid: kSecOIDX509V1ValidityNotAfter)),
      "serialNumber": serialNumber(certificate),
      "signatureAlgorithm": signatureAlgorithm(certificate),
      "keyInfo": keyInfo(certificate),
      "selfSigned": isSelfSigned(certificate),
      "position": position,
    ]
  }

  /**
   * Apple's `SecCertificateCopyValues` returns `{label, type, value}` entries
   * keyed by the OID constant that was asked for. One call per OID keeps the
   * lookup unambiguous even where two constants share an underlying string.
   */
  private static func value(_ certificate: SecCertificate, oid: CFString) -> Any? {
    let values = SecCertificateCopyValues(certificate, [oid] as CFArray, nil) as? [String: Any]
    guard let entry = values?[oid as String] as? [String: Any] else { return nil }
    return entry["value"]
  }

  /** Assemble "CN=example.com, O=Acme" from an RDN array, or "" when absent. */
  private static func name(_ certificate: SecCertificate, oid: CFString) -> String {
    guard let rdns = value(certificate, oid: oid) as? [[String: Any]] else { return "" }
    let parts: [String] = rdns.compactMap { rdn in
      guard
        let attribute = rdn.first(where: { $0.key != "label" && $0.key != "type" }),
        let detail = attribute.value as? [String: Any],
        let text = detail["value"] as? String
      else { return nil }
      return "\(shortName(attribute.key))=\(text)"
    }
    return parts.joined(separator: ", ")
  }

  private static func sans(_ certificate: SecCertificate) -> [String] {
    if let entries = value(certificate, oid: kSecOIDSubjectAltName) as? [[String: Any]] {
      let names: [String] = entries.flatMap { entry in
        entry.compactMap { key, raw in
          guard key != "label", key != "type", let text = raw as? String else { return nil }
          return text
        }
      }
      if !names.isEmpty { return names }
    }
    // Fallback: the documented DNS-names accessor covers the common case.
    return (SecCertificateCopyDNSNames(certificate) as? [String]) ?? []
  }

  private static func date(_ certificate: SecCertificate, oid: CFString) -> Date? {
    guard let raw = value(certificate, oid: oid) else { return nil }
    if let date = raw as? Date { return date }
    if let number = raw as? NSNumber { return Date(timeIntervalSince1970: number.doubleValue) }
    if let text = raw as? String { return ISO8601DateFormatter().date(from: text) }
    return nil
  }

  private static func iso8601(_ date: Date?) -> Any {
    guard let date else { return NSNull() }
    return ISO8601DateFormatter().string(from: date)
  }

  private static func serialNumber(_ certificate: SecCertificate) -> String {
    guard let data = SecCertificateCopySerialNumberData(certificate, nil) as Data? else {
      return ""
    }
    var hex = data.map { String(format: "%02x", $0) }.joined()
    // Match Android's BigInteger-style hex: no leading zero bytes.
    while hex.count > 1 && hex.hasPrefix("0") {
      hex.removeFirst()
    }
    return hex
  }

  private static func signatureAlgorithm(_ certificate: SecCertificate) -> String {
    guard let oid = value(certificate, oid: kSecOIDX509V1SignatureAlgorithm) as? String else {
      return ""
    }
    return signatureAlgorithmNames[oid] ?? oid
  }

  private static func keyInfo(_ certificate: SecCertificate) -> String {
    guard
      let key = SecCertificateCopyKey(certificate),
      let attributes = SecKeyCopyAttributes(key) as? [String: Any]
    else { return "" }

    let type: String
    switch attributes[kSecAttrKeyType as String] as? String {
    case kSecAttrKeyTypeRSA as String: type = "RSA"
    case kSecAttrKeyTypeEC as String: type = "EC"
    case kSecAttrKeyTypeDSA as String: type = "DSA"
    default: type = (attributes[kSecAttrKeyType as String] as? String) ?? "Unknown"
    }
    let bits = (attributes[kSecAttrKeySizeInBits as String] as? NSNumber)?.intValue ?? 0
    return bits > 0 ? "\(type) \(bits)" : type
  }

  /** DER comparison, so formatting can never make two names look equal. */
  private static func isSelfSigned(_ certificate: SecCertificate) -> Bool {
    guard
      let subject = SecCertificateCopyNormalizedSubjectSequence(certificate) as Data?,
      let issuer = SecCertificateCopyNormalizedIssuerSequence(certificate) as Data?
    else { return false }
    return subject == issuer
  }

  /** OID → DN attribute name, for readable subjects and issuers. */
  private static func shortName(_ oid: String) -> String {
    [
      "2.5.4.3": "CN",
      "2.5.4.6": "C",
      "2.5.4.7": "L",
      "2.5.4.8": "ST",
      "2.5.4.10": "O",
      "2.5.4.11": "OU",
      "2.5.4.5": "serialNumber",
      "1.2.840.113549.1.9.1": "emailAddress",
    ][oid] ?? oid
  }

  /** Common signature algorithm OIDs; anything else is reported as its OID. */
  private static let signatureAlgorithmNames: [String: String] = [
    "1.2.840.113549.1.1.5": "SHA1withRSA",
    "1.2.840.113549.1.1.11": "SHA256withRSA",
    "1.2.840.113549.1.1.12": "SHA384withRSA",
    "1.2.840.113549.1.1.13": "SHA512withRSA",
    "1.2.840.113549.1.1.10": "RSASSA-PSS",
    "1.2.840.10045.4.1": "SHA1withECDSA",
    "1.2.840.10045.4.3.2": "SHA256withECDSA",
    "1.2.840.10045.4.3.3": "SHA384withECDSA",
    "1.2.840.10045.4.3.4": "SHA512withECDSA",
  ]
}

/** TLS version/cipher naming from IANA numbers (no enum-case coupling). */
enum TlsNaming {
  static func version(_ value: tls_protocol_version_t) -> String {
    versionNames[UInt16(value.rawValue)] ?? String(format: "0x%04X", value.rawValue)
  }

  static func cipherSuite(_ value: tls_ciphersuite_t) -> String {
    cipherNames[UInt16(value.rawValue)] ?? String(format: "0x%04X", value.rawValue)
  }

  private static let versionNames: [UInt16: String] = [
    0x0301: "TLSv1.0",
    0x0302: "TLSv1.1",
    0x0303: "TLSv1.2",
    0x0304: "TLSv1.3",
    0xFEFF: "DTLSv1.0",
    0xFEFD: "DTLSv1.2",
  ]

  /** The suites an HTTPS server realistically negotiates. */
  private static let cipherNames: [UInt16: String] = [
    0x1301: "TLS_AES_128_GCM_SHA256",
    0x1302: "TLS_AES_256_GCM_SHA384",
    0x1303: "TLS_CHACHA20_POLY1305_SHA256",
    0xC02B: "ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
    0xC02C: "ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
    0xC02F: "ECDHE_RSA_WITH_AES_128_GCM_SHA256",
    0xC030: "ECDHE_RSA_WITH_AES_256_GCM_SHA384",
    0xCCA8: "ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
    0xCCA9: "ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
    0x009C: "RSA_WITH_AES_128_GCM_SHA256",
    0x009D: "RSA_WITH_AES_256_GCM_SHA384",
  ]
}
