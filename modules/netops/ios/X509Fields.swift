import Foundation
import Security

/**
 * Just enough X.509 to *display* a certificate on iOS.
 *
 * The obvious API for this, `SecCertificateCopyValues` (and the `kSecOID…`
 * constants), is macOS-only — the first CI compile of this module proved it:
 * twelve "cannot find in scope" errors, all in this area. iOS exposes only
 * `SecCertificateCopySubjectSummary`, the normalised subject/issuer sequences
 * and the serial number, so the fields the Android half gets for free (issuer
 * display name, validity, SANs, signature algorithm) are read from the DER
 * here.
 *
 * This is a **reader, not a validator**: it walks tags and lengths, extracts a
 * handful of fields, and gives up quietly on anything unexpected (`""`/`[]`
 * rather than a wrong value). Certificate trust is decided by the system, never
 * here (§16.7), so a parse failure can only ever cost detail in the report.
 */
final class DerReader {
  private let bytes: [UInt8]
  private var index = 0

  init(bytes: [UInt8]) {
    self.bytes = bytes
  }

  /** Next tag-length-value, or nil at the end or on malformed input. */
  func readElement() -> (tag: UInt8, content: [UInt8])? {
    guard index < bytes.count else { return nil }
    let tag = bytes[index]
    index += 1
    guard let length = readLength(), length >= 0, index + length <= bytes.count else { return nil }
    let content = Array(bytes[index..<(index + length)])
    index += length
    return (tag, content)
  }

  /** Next element, when it is a SEQUENCE (0x30) or SET (0x31). */
  func readConstructed() -> DerReader? {
    guard let element = readElement(), element.tag == 0x30 || element.tag == 0x31 else {
      return nil
    }
    return DerReader(bytes: element.content)
  }

  /** Read every remaining element: x.509 structures are positional or repeated. */
  func readAll() -> [(tag: UInt8, content: [UInt8])] {
    var elements: [(tag: UInt8, content: [UInt8])] = []
    while let element = readElement() {
      elements.append(element)
    }
    return elements
  }

  /** Next element decoded as an object identifier, e.g. "2.5.29.17". */
  func readOID() -> String? {
    guard let element = readElement(), element.tag == 0x06, let first = element.content.first else {
      return nil
    }
    var values: [UInt64] = [UInt64(first) / 40, UInt64(first) % 40]
    var current: UInt64 = 0
    for byte in element.content.dropFirst() {
      current = (current << 7) | UInt64(byte & 0x7f)
      if byte & 0x80 == 0 {
        values.append(current)
        current = 0
      }
    }
    return values.map(String.init).joined(separator: ".")
  }

  /** Next element decoded as text (the string types a DN or SAN can use). */
  func readString() -> String? {
    guard let element = readElement() else { return nil }
    switch element.tag {
    case 0x0c, 0x13, 0x16, 0x14: // UTF8String, PrintableString, IA5String, TeletexString
      return String(bytes: element.content, encoding: .utf8)
    default:
      return nil
    }
  }

  /** Next element decoded as UTCTime (0x17) or GeneralizedTime (0x18), UTC. */
  func readTime() -> Date? {
    guard let element = readElement(), element.tag == 0x17 || element.tag == 0x18 else {
      return nil
    }
    guard var text = String(bytes: element.content, encoding: .ascii) else { return nil }
    text = text.trimmingCharacters(in: CharacterSet(charactersIn: "Z"))
    let format = element.tag == 0x17 ? "yyMMddHHmmss" : "yyyyMMddHHmmss"
    return X509Fields.timeFormatter(format).date(from: text)
  }

  private func readLength() -> Int? {
    guard index < bytes.count else { return nil }
    let first = bytes[index]
    index += 1
    if first & 0x80 == 0 {
      return Int(first)
    }
    let count = Int(first & 0x7f)
    guard count > 0, count <= 4, index + count <= bytes.count else { return nil }
    var value = 0
    for _ in 0..<count {
      value = (value << 8) | Int(bytes[index])
      index += 1
    }
    return value
  }
}

enum X509Fields {
  /**
   * The fields the TLS report shows, in the shape the Android half produces.
   * Anything unreadable degrades to "" or [] — never to a guessed value.
   */
  static func describe(_ certificate: SecCertificate, position: Int) -> [String: Any] {
    let parsed = Parsed(certificate: SecCertificateCopyData(certificate) as Data)
    let summary = SecCertificateCopySubjectSummary(certificate) as String? ?? ""
    return [
      "subject": summary.isEmpty ? parsed.subject : summary,
      "issuer": parsed.issuer,
      "sans": parsed.sans,
      "notBefore": iso8601(parsed.notBefore),
      "notAfter": iso8601(parsed.notAfter),
      "serialNumber": serialNumber(certificate),
      "signatureAlgorithm": signatureAlgorithmNames[parsed.signatureAlgorithm]
        ?? parsed.signatureAlgorithm,
      "keyInfo": keyInfo(certificate),
      "selfSigned": isSelfSigned(certificate),
      "position": position,
    ]
  }

  fileprivate static func timeFormatter(_ format: String) -> DateFormatter {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.dateFormat = format
    return formatter
  }

  private static func iso8601(_ date: Date?) -> Any {
    guard let date else { return NSNull() }
    let formatter = ISO8601DateFormatter()
    return formatter.string(from: date)
  }

  private static func serialNumber(_ certificate: SecCertificate) -> String {
    let data = SecCertificateCopySerialNumberData(certificate, nil) as Data?
    guard let data else { return "" }
    var hex = data.map { String(format: "%02x", $0) }.joined()
    // Match Android's BigInteger-style hex: no leading zero bytes.
    while hex.count > 1 && hex.hasPrefix("0") {
      hex.removeFirst()
    }
    return hex
  }

  private static func keyInfo(_ certificate: SecCertificate) -> String {
    guard
      let key = SecCertificateCopyKey(certificate),
      let attributes = SecKeyCopyAttributes(key) as? [String: Any]
    else { return "" }

    // RSA and EC only: `kSecAttrKeyTypeDSA` is macOS-only, so an unexpected
    // value is reported as-is rather than guessed.
    let raw = attributes[kSecAttrKeyType as String] as? String ?? ""
    let type: String
    if raw == kSecAttrKeyTypeRSA as String {
      type = "RSA"
    } else if raw == kSecAttrKeyTypeEC as String {
      type = "EC"
    } else {
      type = raw.isEmpty ? "Unknown" : raw
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

  /** The handful of fields the report shows, parsed once. */
  private struct Parsed {
    var subject = ""
    var issuer = ""
    var sans: [String] = []
    var notBefore: Date?
    var notAfter: Date?
    var signatureAlgorithm = ""

    init(certificate data: Data) {
      let outer = DerReader(bytes: [UInt8](data))
      guard let certificate = outer.readConstructed() else { return }
      let certificateChildren = certificate.readAll()
      // Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signature }
      guard certificateChildren.count >= 3 else { return }
      let algorithm = DerReader(bytes: certificateChildren[1].content)
      signatureAlgorithm = algorithm.readOID() ?? ""

      let tbs = DerReader(bytes: certificateChildren[0].content).readAll()
      // TBSCertificate ::= SEQUENCE { [0] version?, serialNumber, signature,
      //   issuer, validity, subject, subjectPublicKeyInfo, [3] extensions? }
      let offset = tbs.first?.tag == 0xA0 ? 1 : 0
      func element(_ index: Int) -> [UInt8]? {
        let position = offset + index
        return position < tbs.count ? tbs[position].content : nil
      }

      if let issuerBytes = element(2) {
        issuer = Parsed.name(from: issuerBytes)
      }
      // Validity ::= SEQUENCE { notBefore Time, notAfter Time } — `element`
      // hands back the *content* of that sequence, so the two times are read
      // directly (an extra readConstructed here would look for a nested SEQUENCE
      // that X.509 does not have).
      if let validityBytes = element(3) {
        let validity = DerReader(bytes: validityBytes)
        notBefore = validity.readTime()
        notAfter = validity.readTime()
      }
      if let subjectBytes = element(4) {
        subject = Parsed.name(from: subjectBytes)
      }
      if let extensions = tbs.last, extensions.tag == 0xA3 {
        sans = Parsed.sans(fromExtensions: extensions.content)
      }
    }

    /** Name ::= SEQUENCE OF RelativeDistinguishedName (a SET of OID/value pairs). */
    static func name(from bytes: [UInt8]) -> String {
      // `bytes` is already the RDNSequence content: a list of RDN SETs.
      let name = DerReader(bytes: bytes)
      var parts: [String] = []
      while let rdn = name.readConstructed() {
        while let attribute = rdn.readConstructed() {
          let oid = attribute.readOID() ?? ""
          let value = attribute.readString() ?? ""
          if !value.isEmpty {
            parts.append("\(shortName(oid))=\(value)")
          }
        }
      }
      return parts.joined(separator: ", ")
    }

    /** Extensions ::= SEQUENCE OF Extension { extnID, critical?, extnValue }. */
    static func sans(fromExtensions bytes: [UInt8]) -> [String] {
      // `bytes` is already the SEQUENCE OF Extension content.
      let extensions = DerReader(bytes: bytes)
      while let extensionValue = extensions.readConstructed() {
        let oid = extensionValue.readOID() ?? ""
        guard oid == "2.5.29.17" else { continue }
        let elements = extensionValue.readAll()
        guard let octets = elements.last, octets.tag == 0x04 else { continue }
        return generalNames(from: octets.content)
      }
      return []
    }

    /** GeneralNames ::= SEQUENCE OF GeneralName (context-tagged alternatives). */
    static func generalNames(from bytes: [UInt8]) -> [String] {
      let reader = DerReader(bytes: bytes)
      guard let names = reader.readConstructed() else { return [] }
      var values: [String] = []
      for element in names.readAll() {
        switch element.tag {
        case 0x81, 0x82, 0x86: // rfc822Name, dNSName, uniformResourceIdentifier
          if let text = String(bytes: element.content, encoding: .utf8) {
            values.append(text)
          }
        case 0x87: // iPAddress
          if element.content.count == 4 {
            values.append(element.content.map { String($0) }.joined(separator: "."))
          }
        default:
          continue
        }
      }
      return values
    }

    /** OID → DN attribute name, for readable subjects and issuers. */
    static func shortName(_ oid: String) -> String {
      [
        "2.5.4.3": "CN",
        "2.5.4.5": "serialNumber",
        "2.5.4.6": "C",
        "2.5.4.7": "L",
        "2.5.4.8": "ST",
        "2.5.4.10": "O",
        "2.5.4.11": "OU",
        "1.2.840.113549.1.9.1": "emailAddress",
      ][oid] ?? oid
    }
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
