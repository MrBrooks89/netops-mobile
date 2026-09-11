/**
 * Saved tab — hosts and networks, with add/edit/delete, tags and export.
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { SavedHost, SavedNetwork } from '../../src/core/model/entities';
import {
  exportSavedHosts,
  exportSavedNetworks,
  type ExportFormat,
} from '../../src/data/export/codecs';
import { shareExport } from '../../src/data/export/share';
import { SavedSection } from '../../src/features/saved/SavedSection';
import { useAppData } from '../../src/providers/AppProviders';
import { Note, ScrollScreen, ToolHeader } from '../../src/ui/components';

export default function SavedTab() {
  const data = useAppData();
  const [hosts, setHosts] = useState<readonly SavedHost[]>([]);
  const [networks, setNetworks] = useState<readonly SavedNetwork[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [hostResult, networkResult] = await Promise.all([
      data.hosts.list(),
      data.networks.list(),
    ]);
    if (!hostResult.ok) setLoadError(hostResult.error.message);
    else setHosts(hostResult.value);
    if (!networkResult.ok) setLoadError(networkResult.error.message);
    else setNetworks(networkResult.value);
  }, [data]);

  // Load-on-mount effect. React Query (M3, plan 12) replaces this pattern for
  // networked operations; until then a screen-scoped load is the simplest
  // correct option, and the state updates happen after `await`.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load-on-mount; React Query replaces this pattern in M3 (plan §12)
    void reload();
  }, [reload]);

  const share = useCallback(
    async (kind: 'hosts' | 'networks', format: ExportFormat) => {
      setShareMessage(null);
      const file =
        kind === 'hosts' ? exportSavedHosts(hosts, format) : exportSavedNetworks(networks, format);
      const result = await shareExport(file);
      setShareMessage(result.ok ? `Shared ${file.filename}` : result.error.message);
    },
    [hosts, networks],
  );

  return (
    <ScrollScreen testID="saved-screen">
      <ToolHeader title="Saved" description="Hosts and networks you keep for later tools" />

      {loadError && (
        <Note tone="error" testID="saved-load-error">
          {loadError}
        </Note>
      )}
      {shareMessage && <Note testID="saved-share-message">{shareMessage}</Note>}

      <SavedSection
        title="Hosts"
        valueLabel="Hostname or IP"
        valuePlaceholder="router.lan or 192.168.1.1"
        valueHint="Saved in canonical form — hostnames are lower-cased."
        items={hosts}
        valueOf={(host) => host.host}
        onCreate={(input) => data.hosts.create({ ...input, host: input.value })}
        onUpdate={(id, input) =>
          data.hosts.update(id, {
            label: input.label,
            host: input.value,
            tags: input.tags,
            notes: input.notes,
          })
        }
        onDelete={(id) => data.hosts.remove(id)}
        onExport={(format) => void share('hosts', format)}
        onChanged={() => void reload()}
      />

      <SavedSection
        title="Networks"
        valueLabel="Network (CIDR)"
        valuePlaceholder="192.168.1.0/24"
        valueHint="Accepts 192.168.1.0/24 or 192.168.1.0 255.255.255.0"
        items={networks}
        valueOf={(network) => network.cidr}
        onCreate={(input) => data.networks.create({ ...input, cidr: input.value })}
        onUpdate={(id, input) =>
          data.networks.update(id, {
            label: input.label,
            cidr: input.value,
            tags: input.tags,
            notes: input.notes,
          })
        }
        onDelete={(id) => data.networks.remove(id)}
        onExport={(format) => void share('networks', format)}
        onChanged={() => void reload()}
      />
    </ScrollScreen>
  );
}
