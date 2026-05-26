// AssemblyAI list prices. Charged per audio-second.
//
// Universal-2 (the model used in submitTranscription): $0.27 / hour.
// Update here when AssemblyAI publishes new pricing — older captured rows
// keep the cost they were inserted with.

export const ASSEMBLYAI_PRICE_PER_HOUR: Record<string, number> = {
  "universal-2": 0.27,
  "universal-1": 0.37,
  nano: 0.12,
};

export function costForTranscription(model: string, durationSec: number): number {
  const ratePerHour = ASSEMBLYAI_PRICE_PER_HOUR[model] ?? 0;
  return (ratePerHour * durationSec) / 3600;
}
