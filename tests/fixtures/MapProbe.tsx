export function MapProbe() {
  return <button onClick={() => {
    throw new Error('solid-source-map-probe');
  }}>Probe</button>;
}
