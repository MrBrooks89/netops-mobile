/**
 * Wi-Fi info — current network snapshot (M5, plan #40).
 *
 * Android gates SSID/BSSID (and channel/frequency details) behind location
 * permission + enabled Location Services; iOS gates them behind an
 * entitlement. So this screen is permission-first: it shows a rationale
 * card with an Allow button (and a settings deep-link once permanently
 * denied), and every gated field renders an explicit "unavailable" row
 * with the reason — never a blank (plan §6.4, §15).
 *
 * A state read, not a probe: refreshes are not recorded to history (M5
 * decision) — history stays network-probe-shaped.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import {
  Button,
  Card,
  Note,
  ScrollScreen,
  SectionTitle,
  StyledText,
  ToolHeader,
  ValueRow,
} from '../../ui/components';
import type { ToolScreenProps } from '../../core/registry/types';
import type { WifiInfo } from '../../core/model/wifi';
import type { PermissionState } from '../../platform/permissions';
import { getCapabilities } from '../../platform/registry';

function WifiRow({
  label,
  value,
  unavailableReason,
  testID,
}: {
  label: string;
  value: string | null;
  /** Why this field is unavailable (permission/services gating). */
  unavailableReason?: string;
  testID: string;
}) {
  return (
    <View testID={testID}>
      <ValueRow
        label={label}
        value={
          value !== null
            ? value
            : `unavailable${unavailableReason !== undefined ? ` — ${unavailableReason}` : ''}`
        }
      />
    </View>
  );
}

export function WifiInfoScreen({ tool }: ToolScreenProps) {
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [info, setInfo] = useState<WifiInfo | null>(null);
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const capabilities = getCapabilities();
  const moduleAvailable = capabilities.wifiInfo !== null;
  const permissionsFlow = capabilities.permissions;

  const refresh = useCallback(async () => {
    const wifiInfo = getCapabilities().wifiInfo;
    if (!wifiInfo) return;
    // Every setState happens after this first await, so the effect-driven
    // initial call never sets state synchronously (react-hooks rule:
    // cascading renders). The busy flag flips in the microtask continuation.
    const state = await permissionsFlow?.get('wifiInfo');
    setReading(true);
    setFailed(null);
    try {
      if (state?.ok) setPermission(state.value);
      setInfo(await wifiInfo.getInfo());
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  }, [permissionsFlow]);

  const askPermission = useCallback(async () => {
    const flow = getCapabilities().permissions;
    if (!flow) return;
    const result = await flow.request('wifiInfo');
    if (result.ok) {
      setPermission(result.value);
      if (result.value.granted) await refresh();
    }
  }, [refresh]);

  const openSettings = useCallback(() => {
    void Linking.openSettings();
  }, []);

  // Initial load: the effect inlines its async body (the lint rule forbids
  // setState reachable synchronously from an effect; an async IIFE with the
  // setState calls after the first await is the compliant shape). refresh()
  // stays for the user-driven Refresh/Allow buttons, where the rule does not
  // apply.
  useEffect(() => {
    let alive = true;
    (async () => {
      const wifiInfo = getCapabilities().wifiInfo;
      const flow = getCapabilities().permissions;
      if (!wifiInfo) return;
      const state = await flow?.get('wifiInfo');
      if (!alive) return;
      if (state?.ok) setPermission(state.value);
      try {
        const info = await wifiInfo.getInfo();
        if (alive) setInfo(info);
      } catch {
        // Initial read failing shows the empty state; Refresh surfaces errors.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const gated = permission !== null && !permission.granted;

  return (
    <ScrollScreen testID="wifi-screen">
      <ToolHeader title={tool.title} description={tool.description} />

      {!moduleAvailable && (
        <Note tone="error" testID="wifi-module-unavailable">
          Wi-Fi information is not available in this build (native module missing). The tool will
          return on builds that include it.
        </Note>
      )}

      {moduleAvailable && permission !== null && gated && (
        <Card testID="wifi-permission-card">
          <SectionTitle>Location permission needed</SectionTitle>
          <StyledText style={{ marginBottom: 8 }}>
            Android attaches the current Wi-Fi name (SSID) to your location — reading it requires
            location permission, and Location Services must be on. The app only reads it to show
            your network here; it is never stored or sent anywhere.
          </StyledText>
          {permission.canAskAgain ? (
            <Button title="Allow location access" onPress={askPermission} testID="wifi-ask" />
          ) : (
            <View>
              <StyledText dim style={{ fontSize: 11, marginBottom: 8 }}>
                The permission was permanently denied. Enable it in system settings, then come back
                and refresh.
              </StyledText>
              <Button
                title="Open settings"
                variant="secondary"
                onPress={openSettings}
                testID="wifi-open-settings"
              />
            </View>
          )}
        </Card>
      )}

      {failed !== null && (
        <Note tone="error" testID="wifi-error">
          {failed}
        </Note>
      )}

      {info !== null && (
        <Card testID="wifi-info">
          <SectionTitle>Current connection</SectionTitle>
          <WifiRow
            label="SSID"
            value={info.ssid}
            unavailableReason="needs location permission + Location Services on"
            testID="wifi-ssid"
          />
          <WifiRow
            label="BSSID"
            value={info.bssid}
            unavailableReason="needs location permission + Location Services on"
            testID="wifi-bssid"
          />
          <WifiRow
            label="Band"
            value={info.band}
            unavailableReason="needs location permission"
            testID="wifi-band"
          />
          <WifiRow
            label="Channel"
            value={info.channel !== null ? String(info.channel) : null}
            unavailableReason="needs location permission"
            testID="wifi-channel"
          />
          <WifiRow
            label="Frequency"
            value={info.frequencyMHz !== null ? `${info.frequencyMHz} MHz` : null}
            unavailableReason="needs location permission"
            testID="wifi-frequency"
          />
          <WifiRow
            label="Signal"
            value={info.rssi !== null ? `${info.rssi} dBm` : null}
            testID="wifi-rssi"
          />
          <WifiRow
            label="Link speed"
            value={info.linkSpeedMbps !== null ? `${info.linkSpeedMbps} Mbps` : null}
            testID="wifi-link-speed"
          />
          <WifiRow
            label="Gateway"
            value={info.gateway}
            unavailableReason="not exposed on this platform"
            testID="wifi-gateway"
          />
          <WifiRow
            label="DNS"
            value={info.dnsServers.length > 0 ? info.dnsServers.join(', ') : null}
            unavailableReason="not exposed on this platform"
            testID="wifi-dns"
          />
          <WifiRow
            label="Transports"
            value={
              [
                info.transportWifi ? 'Wi-Fi' : null,
                info.transportCellular ? 'cellular' : null,
                info.transportEthernet ? 'ethernet' : null,
                info.transportVpn ? 'VPN' : null,
              ]
                .filter((part) => part !== null)
                .join(', ') || null
            }
            testID="wifi-transports"
          />
        </Card>
      )}

      {info !== null && gated && (
        <Note testID="wifi-gated-hint">
          Rows stay &quot;unavailable&quot; until the location permission is granted and Location
          Services is on — that is an Android privacy rule, not a bug.
        </Note>
      )}

      <Card>
        <SectionTitle>Why does a network tool ask for location?</SectionTitle>
        <StyledText dim>
          Android maps the current Wi-Fi name to your physical location, so the OS treats reading it
          as location access. The app uses it only to display your connection here — no location is
          stored, exported, or sent anywhere.
        </StyledText>
        <View style={{ alignItems: 'flex-start', marginTop: 10 }}>
          <Button
            title={reading ? 'Reading…' : 'Refresh'}
            onPress={() => void refresh()}
            disabled={reading || !moduleAvailable}
            testID="wifi-refresh"
          />
        </View>
      </Card>
    </ScrollScreen>
  );
}
