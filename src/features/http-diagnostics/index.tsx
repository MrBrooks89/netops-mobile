/**
 * HTTP diagnostics screen (M6, plan #41).
 *
 * Raw-socket HTTP/1.1: the tool shows every phase timing, the full
 * redirect chain, and the response headers exactly as the server sent
 * them. Body content renders as plain text preview only — the app never
 * renders HTML (plan §16.10).
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
import type { HttpProbeReport } from '../../core/model/http';
import { getCapabilities } from '../../platform/registry';
import { useOperation } from '../../platform/operations/useOperation';
import { parseHttpUrl } from '../../core/validation/httpUrl';
import { err } from '../../core/result/result';
import { toolError } from '../../core/result/toolError';

interface ProbeInput {
  readonly url: string;
}

function phaseMs(value: number | null): string {
  return value === null ? '—' : `${value} ms`;
}

export function HttpDiagnosticsScreen({ tool }: ToolScreenProps) {
  const [urlText, setUrlText] = useState('https://example.com');

  const parsedUrl = useMemo(() => parseHttpUrl(urlText), [urlText]);

  const operation = useOperation<ProbeInput, HttpProbeReport>({
    toolId: 'http-diagnostics',
    describeInput: (input) => input.url,
    summarize: (input, report) =>
      `${report.requestedUrl} → ${report.exchanges[report.exchanges.length - 1]?.status ?? '?'} (${
        report.redirects.length
      } redirects, ${report.totalMs} ms)`,
    run: (input) => {
      const capability = getCapabilities().httpProbe;
      if (!capability) {
        return Promise.resolve(
          err(
            toolError(
              'CAPABILITY_UNAVAILABLE',
              'HTTP diagnostics are not available in this build.',
              {
                technical: 'getCapabilities().httpProbe === null',
              },
            ),
          ),
        );
      }
      return capability.probe(input.url);
    },
  });

  const submit = () => {
    if (!parsedUrl.ok) return;
    operation.run({ url: parsedUrl.value.url });
  };

  const report = operation.data;
  const final = report?.exchanges[report.exchanges.length - 1] ?? null;

  return (
    <ScrollScreen testID="http-screen">
      <ToolHeader title={tool.title} description={tool.description} />

      <Card>
        <Field
          label="URL"
          value={urlText}
          onChangeText={setUrlText}
          placeholder="https://example.com or http://10.0.2.2:9701"
          error={!parsedUrl.ok && urlText.trim() !== '' ? parsedUrl.error.message : null}
          mono
          testID="http-url"
          onSubmitEditing={submit}
        />
        <View style={{ alignItems: 'flex-start', marginTop: 4 }}>
          <Button
            title="Probe"
            onPress={submit}
            disabled={!parsedUrl.ok || operation.isRunning}
            testID="http-submit"
          />
        </View>
        <StyledText dim style={{ fontSize: 11, marginTop: 6 }}>
          One raw HTTP/1.1 GET over a fresh socket per hop. Redirects are followed one at a time (up
          to 10) so every phase is visible — the exact opposite of a browser&apos;s silent follow.
          Plain http:// is spoken deliberately (ADR-007).
        </StyledText>
      </Card>

      <OperationStatus
        isRunning={operation.isRunning}
        runningLabel={`Probing ${urlText}…`}
        error={operation.error}
        canRetry={operation.canRetry}
        onRetry={operation.retry}
        onCancel={operation.cancel}
      />

      {report !== null && final !== null && (
        <>
          <Card testID="http-result">
            <SectionTitle>
              {report.requestedUrl} — {final.status} {final.reasonPhrase}
            </SectionTitle>
            <ValueRow
              label="Status"
              value={`${final.status} ${final.reasonPhrase} (HTTP/${final.httpVersion})`}
              testID="http-status"
            />
            <ValueRow
              label="Hops"
              value={
                report.redirects.length === 0
                  ? 'direct — no redirects'
                  : `${report.redirects.length} redirect${report.redirects.length === 1 ? '' : 's'} → final`
              }
              testID="http-hops"
            />
            {report.redirects.length > 0 && (
              <View testID="http-redirects">
                {report.redirects.map((hop, index) => (
                  <StyledText
                    key={hop.url}
                    dim
                    mono
                    style={{ fontSize: 11 }}
                    testID={`http-hop-${index}`}
                  >
                    {hop.status} → {hop.location ?? '(no location header)'}
                  </StyledText>
                ))}
              </View>
            )}
          </Card>

          <Card>
            <SectionTitle>Phase timings (final hop)</SectionTitle>
            <ValueRow label="DNS" value={phaseMs(report.finalTimings.dnsMs)} testID="http-dns" />
            <ValueRow
              label="Connect"
              value={phaseMs(report.finalTimings.connectMs)}
              testID="http-connect"
            />
            <ValueRow label="TLS" value={phaseMs(report.finalTimings.tlsMs)} testID="http-tls" />
            <ValueRow
              label="First byte"
              value={phaseMs(report.finalTimings.ttfbMs)}
              testID="http-ttfb"
            />
            <ValueRow label="Total (all hops)" value={`${report.totalMs} ms`} testID="http-total" />
            {report.finalTimings.dnsMs === null && (
              <StyledText dim style={{ fontSize: 11, marginTop: 4 }}>
                DNS is resolved inside the native connect (not separately observable) — shown as —
                rather than an invented number.
              </StyledText>
            )}
          </Card>

          <Card>
            <SectionTitle>Response headers</SectionTitle>
            <View testID="http-headers">
              {final.headers.map((header, index) => (
                <CopyableValue
                  key={`${header.name}-${index}`}
                  label={header.name}
                  value={header.value}
                />
              ))}
            </View>
            <ValueRow
              label="Body"
              value={`${final.bodyByteLength} bytes`}
              testID="http-body-size"
            />
            {final.bodyPreview !== null && (
              <StyledText
                dim
                mono
                style={{ fontSize: 11, marginTop: 4 }}
                testID="http-body-preview"
              >
                {final.bodyPreview.slice(0, 400)}
              </StyledText>
            )}
          </Card>
        </>
      )}

      {report === null && !operation.isRunning && !operation.error && (
        <Note testID="http-idle">
          Enter a URL. The probe writes an HTTP/1.1 request by hand over TCP or TLS, follows
          redirects one hop at a time, and reports per-phase timings and the raw headers. Runs are
          saved to History.
        </Note>
      )}
    </ScrollScreen>
  );
}
