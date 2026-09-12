/**
 * Reverse DNS — PTR lookup for an IP address, with a drill-in to the forward
 * lookup for any name it resolves to.
 */

import React, { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import {
  Button,
  Card,
  Chip,
  CopyableValue,
  Field,
  Note,
  OperationStatus,
  ScrollScreen,
  SectionTitle,
  StyledText,
  ToolHeader,
} from '../../ui/components';
import { parseIp } from '../../core/ip/ip';
import { reverseNameFor } from '../../core/dns/reverse';
import { describeProvider, resolveDohEndpoint } from '../../core/dns/provider';
import type { DnsAnswer } from '../../core/dns/types';
import { summarizeAnswers } from '../../core/dns/parse';
import { err } from '../../core/result/result';
import { toolError } from '../../core/result/toolError';
import type { ToolScreenProps } from '../../core/registry/types';
import { getCapabilities } from '../../platform/registry';
import { useOperation } from '../../platform/operations/useOperation';
import { useAppSettings } from '../../providers/AppProviders';

interface ReverseInput {
  readonly ip: string;
  readonly endpoint: string;
}

const EXAMPLES = ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888'];

export function ReverseDnsScreen({ tool }: ToolScreenProps) {
  const { settings } = useAppSettings();
  const [ip, setIp] = useState('8.8.8.8');

  const parsedIp = useMemo(() => parseIp(ip), [ip]);
  const reverseName = useMemo(() => reverseNameFor(ip), [ip]);
  const endpoint = useMemo(
    () => resolveDohEndpoint(settings.dohProvider, settings.customDohUrl),
    [settings.dohProvider, settings.customDohUrl],
  );

  const operation = useOperation<ReverseInput, DnsAnswer[]>({
    toolId: 'reverse-dns',
    describeInput: (input) => `PTR ${input.ip}`,
    summarize: (input, answers) => `PTR ${input.ip} → ${summarizeAnswers(answers)}`,
    run: (input, context) => {
      const capability = getCapabilities().dnsReverse;
      if (!capability) {
        return Promise.resolve(
          err(
            toolError('CAPABILITY_UNAVAILABLE', 'Reverse DNS is not available in this build.', {
              technical: 'getCapabilities().dnsReverse === null',
            }),
          ),
        );
      }
      return capability.reverse(input.ip, { endpoint: input.endpoint, signal: context.signal });
    },
  });

  const submit = () => {
    if (!parsedIp.ok || !endpoint.ok) return;
    operation.run({ ip: ip.trim(), endpoint: endpoint.value });
  };

  const inputError = !parsedIp.ok
    ? ip.trim() === ''
      ? null
      : parsedIp.error.message
    : !endpoint.ok
      ? endpoint.error.message
      : null;

  return (
    <ScrollScreen testID="reverse-dns-screen">
      <ToolHeader title={tool.title} description={tool.description} />

      <Card>
        <Field
          label="IP address"
          value={ip}
          onChangeText={setIp}
          placeholder="8.8.8.8"
          error={inputError}
          hint={
            reverseName.ok
              ? `Asks for ${reverseName.value}`
              : `Queries go to ${describeProvider(settings.dohProvider, settings.customDohUrl)}.`
          }
          // reverseName is derived from the same input as parsedIp, so its
          // failure case is already surfaced by the `error` prop above.
          mono
          testID="reverse-ip"
          onSubmitEditing={submit}
        />

        <View style={{ alignItems: 'flex-start', marginTop: 4 }}>
          <Button
            title="Look up"
            onPress={submit}
            disabled={!parsedIp.ok || !endpoint.ok || operation.isRunning}
            testID="reverse-submit"
          />
        </View>

        <SectionTitle>Examples</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {EXAMPLES.map((example) => (
            <Chip
              key={example}
              label={example}
              selected={ip.trim() === example}
              onPress={() => setIp(example)}
              testID={`reverse-example-${example}`}
            />
          ))}
        </View>
      </Card>

      <OperationStatus
        isRunning={operation.isRunning}
        runningLabel="Asking the resolver for a PTR record…"
        error={operation.error}
        canRetry={operation.canRetry}
        onRetry={operation.retry}
      />

      {operation.data !== null && (
        <Card>
          <SectionTitle>
            {operation.data.length} PTR record{operation.data.length === 1 ? '' : 's'}
          </SectionTitle>
          {operation.data.length === 0 ? (
            <StyledText dim testID="reverse-no-records">
              No PTR record is published for {ip.trim()}.
            </StyledText>
          ) : (
            operation.data.map((answer, index) => (
              <View key={`${answer.value}-${index}`}>
                <CopyableValue label={answer.name} value={answer.value} />
                {answer.ttl !== null && (
                  <StyledText dim style={{ fontSize: 11, marginTop: 2 }}>
                    TTL {answer.ttl}s
                  </StyledText>
                )}
                <View style={{ alignItems: 'flex-start', marginTop: 6, marginBottom: 8 }}>
                  <Button
                    title="Look up this name"
                    variant="secondary"
                    onPress={() =>
                      router.push({
                        pathname: '/tool/[id]',
                        params: { id: 'dns-lookup', name: answer.value },
                      })
                    }
                    testID={`reverse-forward-${index}`}
                  />
                </View>
              </View>
            ))
          )}
        </Card>
      )}

      {operation.data === null && !operation.isRunning && !operation.error && (
        <Note testID="reverse-idle">
          Reverse DNS asks which name an address points back to. Not every address has one.
        </Note>
      )}
    </ScrollScreen>
  );
}
