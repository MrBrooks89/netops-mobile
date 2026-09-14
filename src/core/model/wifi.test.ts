import { bandForFrequencyMHz, channelForFrequencyMHz, toWifiInfo, type RawWifiInfo } from './wifi';

describe('channelForFrequencyMHz', () => {
  it('maps 2.4 GHz channels', () => {
    expect(channelForFrequencyMHz(2412)).toBe(1);
    expect(channelForFrequencyMHz(2437)).toBe(6);
    expect(channelForFrequencyMHz(2472)).toBe(13);
  });

  it('maps 5 GHz channels', () => {
    expect(channelForFrequencyMHz(5180)).toBe(36);
    expect(channelForFrequencyMHz(5240)).toBe(48);
    expect(channelForFrequencyMHz(5745)).toBe(149);
  });

  it('maps 6 GHz channels (5 GHz tops out at 5925; 6 GHz starts at 5955)', () => {
    expect(channelForFrequencyMHz(5955)).toBe(1);
    expect(channelForFrequencyMHz(6105)).toBe(31);
    expect(channelForFrequencyMHz(6875)).toBe(185);
    // Boundary: last 5 GHz channel and first 6 GHz channel; the gap between
    // them has no valid channel.
    expect(channelForFrequencyMHz(5925)).toBe(185);
    expect(channelForFrequencyMHz(5930)).toBeNull();
  });

  it('returns null outside known bands', () => {
    for (const freq of [0, 2400, 2500, 4999, 5930, 5940, 7200]) {
      expect(channelForFrequencyMHz(freq)).toBeNull();
    }
  });
});

describe('bandForFrequencyMHz', () => {
  it('labels the three bands', () => {
    expect(bandForFrequencyMHz(2412)).toBe('2.4 GHz');
    expect(bandForFrequencyMHz(5180)).toBe('5 GHz');
    expect(bandForFrequencyMHz(5955)).toBe('6 GHz');
  });

  it('returns null outside known bands', () => {
    expect(bandForFrequencyMHz(3600)).toBeNull();
  });
});

describe('toWifiInfo', () => {
  it('maps a full raw read with derived channel and band', () => {
    const raw: RawWifiInfo = {
      ssid: 'HomeNet',
      bssid: 'aa:bb:cc:dd:ee:ff',
      frequencyMHz: 5180,
      rssi: -52,
      linkSpeedMbps: 866,
      transportWifi: true,
      transportCellular: false,
      transportVpn: false,
      transportEthernet: false,
    };
    const info = toWifiInfo(raw);
    expect(info.ssid).toBe('HomeNet');
    expect(info.channel).toBe(36);
    expect(info.band).toBe('5 GHz');
    expect(info.rssi).toBe(-52);
    expect(info.transportWifi).toBe(true);
    expect(info.readAt).toBeTruthy();
  });

  it('keeps every field null when the platform returns nothing', () => {
    const info = toWifiInfo(null);
    expect(info.ssid).toBeNull();
    expect(info.bssid).toBeNull();
    expect(info.channel).toBeNull();
    expect(info.band).toBeNull();
    expect(info.frequencyMHz).toBeNull();
    expect(info.transportWifi).toBe(false);
    // The screen renders "unavailable" rows from these nulls — never blanks.
  });

  it('carries partial reads through without inventing values', () => {
    const raw: RawWifiInfo = {
      ssid: null,
      bssid: null,
      frequencyMHz: null,
      rssi: -70,
      linkSpeedMbps: null,
      transportWifi: true,
      transportCellular: true,
      transportVpn: false,
      transportEthernet: false,
    };
    const info = toWifiInfo(raw);
    expect(info.ssid).toBeNull();
    expect(info.rssi).toBe(-70);
    expect(info.channel).toBeNull();
    expect(info.transportCellular).toBe(true);
  });
});
