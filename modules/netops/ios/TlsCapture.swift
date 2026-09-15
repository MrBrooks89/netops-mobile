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
 *  - Certificate fields come from `X509Fields` (a small DER reader): the
 *    convenient `SecCertificateCopyValues`/`kSecOID…` API is macOS-only, which
 *    the first iOS compile of this module proved. Subject still prefers
 *    `SecCertificateCopySubjectSummary`.
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
        X509Fields.describe(certificate, position: index)
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
