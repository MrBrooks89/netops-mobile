/**
 * TLS Inspector screen (M6, plan #43).
 *
 * Shows the certificate chain the server presented: subject/issuer/SANs,
 * validity window, serial, signature + key info, self-signed flag, and a
 * live expiry countdown with the < 14-day warning (plan §18 M6). The
 * report is exportable as JSON through the same share sheet every other
 * export uses. Capture is display-only (§16.7) — nothing here alters
 * validation for any other network call.
 */

import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import {
  Button,
  Card,
  CopyableValue,
  Field,
  Note,
  OperationStatus,
  ScrollScreen,
  SectionTitle,
  StyledText,
  ToolHeader,
  ValueRow,
} from '../../ui/components';
import type { ToolScreenProps } from '../../core/registry/types';
import type { TlsCertificate, TlsReport } from '../../core/model/tls';
import { tlsExpiry } from '../../core/model/tls';
import { getCapabilities } from '../../platform/registry';
import { useOperation } from '../../platform/operations/useOperation';
import { parseHostInput, parsePortInput } from '../../core/validation/host';
import { err } from '../../core/result/result';
import { toolError } from '../../core/result/toolError';
import { shareExport } from '../../data/export/share';
import type { ExportFile } from '../../data/export/codecs';

interface InspectInput {
  readonly host: string;
  readonly port: number;
}

function toExportFile(report: TlsReport): ExportFile {
  const stamp = new Date(report.finishedAt).toISOString().replace(/[:.]/g, '-');
  return {
    filename: `tls-${report.host}-${stamp}.json`,
    mimeType: 'application/json',
    contents: JSON.stringify(
      {
        schema: 'netops.tls-report/1',
        exportedAt: new Date().toISOString(),
        report,
      },
      null,
      2,
    ),
  };
}

function CertificateCard({ cert, index }: { cert: TlsCertificate; index: number }) {
  const expiry = tlsExpiry(cert);
  return (
    <Card testID={`tls-cert-${index}`}>
      <SectionTitle>
        {index === 0 ? 'Leaf certificate' : `Chain ${index + 1}`}
        {cert.selfSigned ? ' — self-signed' : ''}
      </SectionTitle>
      <ValueRow label="Subject" value={cert.subject} />
      <ValueRow label="Issuer" value={cert.issuer} />
      <ValueRow label="Valid" value={`${cert.notBefore} → ${cert.notAfter}`} />
      <ValueRow
        label="Expires"
        value={
          expiry.expired
            ? `expired ${-expiry.daysRemaining} day${expiry.daysRemaining === -1 ? '' : 's'} ago`
            : `in ${expiry.daysRemaining} day${expiry.daysRemaining === 1 ? '' : 's'}`
        }
        testID={`tls-expiry-${index}`}
      />
      {expiry.expired && (
        <Note tone="error" testID={`tls-expired-${index}`}>
          This certificate has expired — connections are being rejected by validating clients.
        </Note>
      )}
      {!expiry.expired && expiry.expiringSoon && (
        <Note tone="error" testID={`tls-expiring-soon-${index}`}>
          Expiring in {expiry.daysRemaining} day{expiry.daysRemaining === 1 ? '' : 's'} — plan the
          renewal now.
        </Note>
      )}
      {cert.sans.length > 0 && (
        <View style={{ marginTop: 6 }}>
          <StyledText dim style={{ fontSize: 11 }}>
            SANs
          </StyledText>
          {cert.sans.map((san) => (
            <StyledText key={san} mono style={{ fontSize: 12 }} testID={`tls-san-${index}`}>
              {san}
            </StyledText>
          ))}
        </View>
      )}
      <CopyableValue label="Serial" value={cert.serialNumber} />
      <ValueRow label="Signature" value={cert.signatureAlgorithm} />
      <ValueRow label="Key" value={cert.keyInfo} />
    </Card>
  );
}

export function TlsInspectorScreen({ tool }: ToolScreenProps) {
  const [host, setHost] = useState('example.com');
  const [portText, setPortText] = useState('443');

  const parsedHost = useMemo(() => parseHostInput(host), [host]);
  const parsedPort = useMemo(() => parsePortInput(portText), [portText]);

  const operation = useOperation<InspectInput, TlsReport>({
    toolId: 'tls-inspector',
    describeInput: (input) => `${input.host}:${input.port}`,
    summarize: (input, report) =>
      report.chain.length > 0
        ? `${input.host}:${input.port} — chain of ${report.chain.length}, ${
            report.chain[0].selfSigned ? 'self-signed leaf' : 'CA-signed leaf'
          } (${report.tlsVersion ?? '?'})`
        : `${input.host}:${input.port} — no chain captured`,
    run: (input) => {
      const capability = getCapabilities().tlsInspect;
      if (!capability) {
        return Promise.resolve(
          err(
            toolError('CAPABILITY_UNAVAILABLE', 'TLS inspection is not available in this build.', {
              technical: 'getCapabilities().tlsInspect === null',
            }),
          ),
        );
      }
      return capability.inspect(input.host, input.port);
    },
  });

  const submit = () => {
    if (!parsedHost.ok || !parsedPort.ok) return;
    operation.run({ host: parsedHost.value, port: parsedPort.value });
  };

  const exportReport = async () => {
    if (operation.data === null) return;
    await shareExport(toExportFile(operation.data));
  };

  const report = operation.data;

  return (
    <ScrollScreen testID="tls-screen">
      <ToolHeader title={tool.title} description={tool.description} />

      <Card>
        <Field
          label="Host"
          value={host}
          onChangeText={setHost}
          placeholder="example.com"
          error={!parsedHost.ok && host.trim() !== '' ? parsedHost.error.message : null}
          mono
          testID="tls-host"
          onSubmitEditing={submit}
        />
        <Field
          label="Port"
          value={portText}
          onChangeText={setPortText}
          placeholder="443"
          error={!parsedPort.ok && portText.trim() !== '' ? parsedPort.error.message : null}
          mono
          testID="tls-port"
          onSubmitEditing={submit}
        />
        <View style={{ alignItems: 'flex-start', marginTop: 4 }}>
          <Button
            title="Inspect"
            onPress={submit}
            disabled={!parsedHost.ok || !parsedPort.ok || operation.isRunning}
            testID="tls-submit"
          />
        </View>
        <StyledText dim style={{ fontSize: 11, marginTop: 6 }}>
          One TLS handshake is made and the chain it presents is recorded for display. Nothing is
          validated as a side effect — your other connections keep full system validation.
        </StyledText>
      </Card>

      <OperationStatus
        isRunning={operation.isRunning}
        runningLabel={`Inspecting ${host}:${portText}…`}
        error={operation.error}
        canRetry={operation.canRetry}
        onRetry={operation.retry}
        onCancel={operation.cancel}
      />

      {report !== null && (
        <>
          <Card testID="tls-result">
            <SectionTitle>
              {report.host}:{report.port}
            </SectionTitle>
            <ValueRow
              label="TLS version"
              value={report.tlsVersion ?? 'unknown'}
              testID="tls-version"
            />
            <ValueRow label="Cipher" value={report.cipherSuite ?? 'unknown'} testID="tls-cipher" />
            <ValueRow
              label="Chain length"
              value={`${report.chain.length} certificate${report.chain.length === 1 ? '' : 's'}`}
              testID="tls-chain-length"
            />
            {report.chain[0]?.selfSigned === true && (
              <Note tone="error" testID="tls-self-signed">
                Self-signed certificate — a standard client would reject this chain unless the CA is
                manually trusted.
              </Note>
            )}
            <View style={{ alignItems: 'flex-start', marginTop: 8 }}>
              <Button
                title="Export report"
                variant="secondary"
                onPress={() => void exportReport()}
                testID="tls-export"
              />
            </View>
          </Card>

          {report.chain.map((cert, index) => (
            <CertificateCard key={`${cert.serialNumber}-${index}`} cert={cert} index={index} />
          ))}
        </>
      )}

      {report === null && !operation.isRunning && !operation.error && (
        <Note testID="tls-idle">
          Enter a host (and port, 443 by default). The tool completes one TLS handshake, records the
          certificate chain the server presents, and shows validity, SANs, and an expiry countdown.
          Runs are saved to History.
        </Note>
      )}
    </ScrollScreen>
  );
}
