export interface RuntimeCapabilities {
  genes: boolean
  evolutionLog: boolean
  llmConfig: boolean
  dataRoot: string
}

const CAPS: Record<string, RuntimeCapabilities> = {
  openclaw: { genes: true, evolutionLog: true, llmConfig: true, dataRoot: '.openclaw' },
  hermes: { genes: false, evolutionLog: false, llmConfig: false, dataRoot: '.hermes' },
  nanobot: { genes: false, evolutionLog: false, llmConfig: false, dataRoot: '.nanobot' },
}

export function getRuntimeCaps(runtime: string): RuntimeCapabilities {
  return CAPS[runtime] ?? CAPS.openclaw
}
