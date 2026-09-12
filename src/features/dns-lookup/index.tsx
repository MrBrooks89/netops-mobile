/**
 * DNS lookup — resolve A/AAAA/CNAME/MX/NS/TXT over DNS-over-HTTPS.
 *
 * The resolver is a capability, the run is an operation (so it appears in
 * history and can be cancelled), and the provider comes from Settings — the
 * screen itself is just the form and the results.
 */

import React, { useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
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
import { DNS_RECORD_TYPES, type DnsAnswer, type DnsRecordType } from '../../core/dns/types';
import { parseDnsName } from '../../core/dns/name';
import { describeProvider, resolveDohEndpoint } from '../../core/dns/provider';
import { summarizeAnswers } from '../../core/dns/parse';
import { err } from '../../core/result/result';
import { toolError } from '../../core/result/toolError';
import type { ToolScreenProps } from '../../core/registry/types';
import { getCapabilities } from '../../platform/registry';
import { useOperation } from '../../platform/operations/useOperation';
import { useAppSettings } from '../../providers/AppProviders';

interface LookupInput {
  readonly name: string;
  readonly type: DnsRecordType;
  readonly endpoint: string;
}

const EXAMPLES: readonly { name: string; type: DnsRecordType }[] = [
  { name: 'example.com', type: 'A' },
  { name: 'example.com', type: 'AAAA' },
  { name: 'www.example.com', type: 'CNAME' },
  { name: 'example.com', type: 'MX' },
  { name: 'example.com', type: 'NS' },
  { name: 'example.com', type: 'TXT' },
];

export function DnsLookupScreen({ tool }: ToolScreenProps) {
  // Deep link support: the reverse-DNS screen can jump here with a name.
  const params = useLocalSearchParams<{ name?: string }>();
  const initialName =
    typeof params.name === 'string' && params.name !== '' ? params.name : 'example.com';

  const { settings } = useAppSettings();
  const [name, setName] = useState(initialName);
  const [type, setType] = useState<DnsRecordType>('A');

  const parsed = useMemo(() => parseDnsName(name), [name]);
  const endpoint = useMemo(
    () => resolveDohEndpoint(settings.dohProvider, settings.customDohUrl),
    [settings.dohProvider, settings.customDohUrl],
  );

  const operation = useOperation<LookupInput, DnsAnswer[]>({
    toolId: 'dns-lookup',
    describeInput: (input) => `${input.type} ${input.name}`,
    summarize: (input, answers) => `${input.type} ${input.name} → ${summarizeAnswers(answers)}`,
    run: (input, context) => {
      const capability = getCapabilities().dnsResolve;
      if (!capability) {
        return Promise.resolve(
          err(
            toolError('CAPABILITY_UNAVAILABLE', 'DNS lookups are not available in this build.', {
              technical: 'getCapabilities().dnsResolve === null',
            }),
          ),
        );
      }
      return capability.resolve(input.name, input.type, {
        endpoint: input.endpoint,
        signal: context.signal,
      });
    },
  });

  const submit = () => {
    if (!parsed.ok || !endpoint.ok) return;
    operation.run({ name: parsed.value, type, endpoint: endpoint.value });
  };

  // Show a name problem first (it is what the user is editing), then a provider
  // problem. An empty field is not an error, just not ready.
  const inputError = !parsed.ok
    ? name.trim() === ''
      ? null
      : parsed.error.message
    : !endpoint.ok
      ? endpoint.error.message
      : null;

  return (
    <ScrollScreen testID="dns-lookup-screen">
      <ToolHeader title={tool.title} description={tool.description} />

      <Card>
        <Field
          label="Domain name"
          value={name}
          onChangeText={setName}
          placeholder="example.com"
          error={inputError}
          hint={`Queries go to ${describeProvider(settings.dohProvider, settings.customDohUrl)} (change this in Settings).`}
          mono
          testID="dns-name"
          onSubmitEditing={submit}
        />

        <SectionTitle>Record type</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {DNS_RECORD_TYPES.filter((recordType) => recordType !== 'PTR').map((recordType) => (
            <Chip
              key={recordType}
              label={recordType}
              selected={type === recordType}
              onPress={() => setType(recordType)}
              testID={`dns-type-${recordType}`}
              radio
            />
          ))}
        </View>

        <View style={{ alignItems: 'flex-start', marginTop: 4 }}>
          <Button
            title="Look up"
            onPress={submit}
            disabled={!parsed.ok || !endpoint.ok || operation.isRunning}
            testID="dns-submit"
          />
        </View>

        <SectionTitle>Examples</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {EXAMPLES.map((example) => (
            <Chip
              key={`${example.name}-${example.type}`}
              label={`${example.type} ${example.name}`}
              selected={name.trim() === example.name && type === example.type}
              onPress={() => {
                setName(example.name);
                setType(example.type);
              }}
              testID={`dns-example-${example.type}`}
            />
          ))}
        </View>
      </Card>

      <OperationStatus
        isRunning={operation.isRunning}
        runningLabel={`Looking up ${type} records…`}
        error={operation.error}
        canRetry={operation.canRetry}
        onRetry={operation.retry}
        onCancel={operation.cancel}
      />

      {operation.data !== null && operation.dataInput !== null && (
        <Card>
          <SectionTitle>
            {operation.data.length} {operation.dataInput.type} record
            {operation.data.length === 1 ? '' : 's'}
          </SectionTitle>
          {operation.data.length === 0 ? (
            <StyledText dim testID="dns-no-records">
              No {operation.dataInput.type} records exist for {operation.dataInput.name}.
            </StyledText>
          ) : (
            operation.data.map((answer, index) => (
              <View key={`${answer.type}-${answer.value}-${index}`}>
                <CopyableValue
                  label={
                    answer.priority === undefined
                      ? answer.name
                      : `${answer.name} (priority ${answer.priority})`
                  }
                  value={answer.value}
                />
                {answer.ttl !== null && (
                  <StyledText dim style={{ fontSize: 11, marginTop: 2 }}>
                    TTL {answer.ttl}s
                  </StyledText>
                )}
              </View>
            ))
          )}
        </Card>
      )}

      {operation.data === null && !operation.isRunning && !operation.error && (
        <Note testID="dns-idle">
          Enter a name and pick a record type. Results are saved to History with the resolver you
          chose.
        </Note>
      )}
    </ScrollScreen>
  );
}
