/**
 * VLSM calculator — base network + host requirements → greedy allocation table.
 *
 * Requests are editable rows (name + host count). The allocator itself lives
 * in core/vlsm; this screen only collects input and renders the report,
 * including a plain-language explanation when the requirements do not fit.
 */

import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  Chip,
  CopyableValue,
  Field,
  Note,
  ScrollScreen,
  SectionTitle,
  StyledText,
  ToolHeader,
  useTheme,
} from '../../ui/components';
import type { ToolScreenProps } from '../../core/registry/types';
import { cidrToString, type Ipv4Cidr } from '../../core/ip/cidr';
import {
  MAX_VLSM_REQUESTS,
  allocateVlsm,
  type VlsmReport,
  type VlsmRequest,
} from '../../core/vlsm/vlsm';
import { addressesLabel, hostsLabel } from '../../core/util/format';
import { parseV4CidrInput } from '../_shared/input';
import { useCalculatorHistory } from '../_shared/useCalculatorHistory';

interface RequirementRow {
  readonly id: number;
  name: string;
  hosts: string;
}

const EXAMPLES = ['192.168.1.0/24', '10.0.0.0/22', '172.16.0.0/16'];

/** Seeded so the screen demonstrates the algorithm on first open. */
const INITIAL_ROWS: RequirementRow[] = [
  { id: 1, name: 'Sales', hosts: '100' },
  { id: 2, name: 'Engineering', hosts: '50' },
  { id: 3, name: 'VoIP', hosts: '20' },
];

type VlsmState = { kind: 'rowError'; message: string } | { kind: 'report'; report: VlsmReport };

/**
 * Turn the editable rows into an allocation report. Pure and hook-free so the
 * screen body stays straight-line code.
 */
function computeVlsm(cidr: Ipv4Cidr, rows: readonly RequirementRow[]): VlsmState {
  const requests: VlsmRequest[] = [];
  for (const row of rows) {
    const raw = row.hosts.trim();
    if (raw === '') {
      // a completely empty row is ignored rather than an error
      if (row.name.trim() === '') continue;
      return { kind: 'rowError', message: `Enter a host count for "${row.name}".` };
    }
    const hosts = Number(raw);
    if (!Number.isInteger(hosts) || hosts < 1) {
      return {
        kind: 'rowError',
        message: `"${row.name || 'subnet'}" needs a whole number of hosts (1 or more).`,
      };
    }
    requests.push({
      name: row.name.trim() === '' ? undefined : row.name.trim(),
      requiredHosts: hosts,
    });
  }

  if (requests.length === 0) return { kind: 'rowError', message: 'Add at least one requirement.' };

  const allocation = allocateVlsm(cidr, requests);
  if (!allocation.ok) return { kind: 'rowError', message: allocation.error.message };
  return { kind: 'report', report: allocation.value };
}

export function VlsmCalculatorScreen({ tool }: ToolScreenProps) {
  const { theme } = useTheme();
  const [base, setBase] = useState('192.168.1.0/24');
  const [rows, setRows] = useState<RequirementRow[]>(INITIAL_ROWS);
  // Row ids only need to be unique within this screen; a ref keeps them stable
  // per mount and regenerated identically after a remount.
  const nextId = useRef(INITIAL_ROWS.length + 1);

  const parsed = parseV4CidrInput(base);

  const result: VlsmState | null = parsed.state === 'valid' ? computeVlsm(parsed.cidr, rows) : null;

  useCalculatorHistory({
    toolId: 'vlsm-calculator',
    input: `${base}|${rows.map((row) => `${row.name}:${row.hosts}`).join(',')}`,
    summary:
      result?.kind === 'report'
        ? `${result.report.allocations.length} subnets in ${base.trim()}`
        : null,
    detail: result?.kind === 'report' ? result.report : null,
  });

  const inputError = parsed.state === 'error' ? parsed.message : null;
  const rowError = result?.kind === 'rowError' ? result.message : null;

  const updateRow = (id: number, patch: Partial<RequirementRow>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const addRow = () => {
    if (rows.length >= MAX_VLSM_REQUESTS) return;
    const id = nextId.current++;
    setRows((current) => [...current, { id, name: '', hosts: '' }]);
  };

  const removeRow = (id: number) =>
    setRows((current) => (current.length <= 1 ? current : current.filter((row) => row.id !== id)));

  return (
    <ScrollScreen testID="vlsm-screen">
      <ToolHeader title={tool.title} description={tool.description} />

      <Card>
        <Field
          label="Base network"
          value={base}
          onChangeText={setBase}
          placeholder="192.168.1.0/24"
          error={inputError}
          hint="The network you are carving up."
          mono
          testID="vlsm-base"
        />
        <SectionTitle>Examples</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {EXAMPLES.map((example) => (
            <Chip
              key={example}
              label={example}
              selected={base.trim() === example}
              onPress={() => setBase(example)}
              testID={`vlsm-example-${example}`}
            />
          ))}
        </View>
      </Card>

      <Card>
        <SectionTitle>Requirements ({rows.length})</SectionTitle>
        {rows.map((row) => (
          <View key={row.id} style={[styles.rowGroup, { borderColor: theme.colors.border }]}>
            <View style={styles.rowFields}>
              <View style={styles.nameField}>
                <Field
                  label="Name (optional)"
                  value={row.name}
                  onChangeText={(text) => updateRow(row.id, { name: text })}
                  placeholder="Sales"
                  testID={`vlsm-name-${row.id}`}
                />
              </View>
              <View style={styles.hostsField}>
                <Field
                  label="Hosts"
                  value={row.hosts}
                  onChangeText={(text) => updateRow(row.id, { hosts: text })}
                  placeholder="50"
                  testID={`vlsm-hosts-${row.id}`}
                />
              </View>
            </View>
            {rows.length > 1 && (
              <Button
                title="Remove"
                variant="secondary"
                onPress={() => removeRow(row.id)}
                testID={`vlsm-remove-${row.id}`}
              />
            )}
          </View>
        ))}
        <View style={styles.addButton}>
          <Button
            title="Add subnet"
            variant="secondary"
            onPress={addRow}
            disabled={rows.length >= MAX_VLSM_REQUESTS}
            testID="vlsm-add"
          />
        </View>
      </Card>

      {parsed.state === 'empty' && <Note testID="vlsm-empty">Enter a base network.</Note>}

      {rowError && (
        <Note tone="error" testID="vlsm-row-error">
          {rowError}
        </Note>
      )}

      {result?.kind === 'report' && (
        <>
          {!result.report.fits && (
            <Note tone="warn" testID="vlsm-does-not-fit">
              These requirements do not fit in {cidrToString(result.report.base)}. Everything that
              could be placed is shown below; each unplaced subnet lists what was missing.
            </Note>
          )}

          {result.report.allocations.length > 0 && (
            <Card>
              <SectionTitle>Allocation ({result.report.allocations.length})</SectionTitle>
              {result.report.allocations.map((allocation, index) => (
                <View key={`${cidrToString(allocation.cidr)}-${index}`} style={styles.allocation}>
                  <StyledText style={styles.allocationName}>
                    {allocation.name ?? `Subnet ${index + 1}`}
                    {allocation.pointToPoint ? '  (point-to-point /31)' : ''}
                  </StyledText>
                  <CopyableValue label="Network" value={cidrToString(allocation.cidr)} />
                  <CopyableValue label="Range" value={allocation.hostRange} />
                  <CopyableValue label="Usable" value={hostsLabel(allocation.usable)} />
                  <CopyableValue label="Requested" value={hostsLabel(allocation.requiredHosts)} />
                  <CopyableValue label="Waste" value={hostsLabel(allocation.waste)} />
                </View>
              ))}
            </Card>
          )}

          {result.report.failures.length > 0 && (
            <Card>
              <SectionTitle>Could not place ({result.report.failures.length})</SectionTitle>
              {result.report.failures.map((failure, index) => (
                <Note key={`${failure.name ?? 'subnet'}-${index}`} tone="error">
                  {failure.name ?? `Subnet ${index + 1}`}: needs {hostsLabel(failure.requiredHosts)}
                  . {failure.reason}
                </Note>
              ))}
            </Card>
          )}

          <Card>
            <SectionTitle>Totals</SectionTitle>
            <CopyableValue
              label="Requested"
              value={hostsLabel(result.report.totalRequestedHosts)}
            />
            <CopyableValue
              label="Allocated usable"
              value={hostsLabel(result.report.totalAllocatedUsable)}
            />
            <CopyableValue label="Waste" value={hostsLabel(result.report.totalWaste)} />
            <CopyableValue
              label="Unallocated"
              value={addressesLabel(result.report.unallocatedAddresses)}
            />
          </Card>

          {result.report.unallocatedSpace.length > 0 && (
            <Card>
              <SectionTitle>Remaining space ({result.report.unallocatedSpace.length})</SectionTitle>
              {result.report.unallocatedSpace.map((block) => (
                <CopyableValue
                  key={cidrToString(block)}
                  label={`/${block.prefixLength}`}
                  value={cidrToString(block)}
                />
              ))}
            </Card>
          )}
        </>
      )}

      <StyledText dim style={{ fontSize: 12 }}>
        Tip: tap any value to copy it.
      </StyledText>
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  rowGroup: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 4 },
  rowFields: { flexDirection: 'row', gap: 10 },
  nameField: { flex: 2 },
  hostsField: { flex: 1 },
  addButton: { marginTop: 4, alignItems: 'flex-start' },
  allocation: { marginBottom: 14 },
  allocationName: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
});
