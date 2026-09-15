import {
  createPlayerConfig,
  playerConfigSchema,
  type PlayerConfig,
} from "@aside/engine/player";

const key = "aside.playerConfig.v1";

export function loadPlayerConfig(
  storage?: Pick<Storage, "getItem">,
): PlayerConfig {
  try {
    const raw = (storage ?? localStorage).getItem(key);
    if (raw !== null) return playerConfigSchema.parse(JSON.parse(raw));
  } catch {
    // Private browsing, old settings or corrupted storage must not prevent listening.
  }
  return createPlayerConfig();
}

export function savePlayerConfig(
  config: PlayerConfig,
  storage?: Pick<Storage, "setItem">,
) {
  try {
    (storage ?? localStorage).setItem(key, JSON.stringify(config));
  } catch {
    // Playback remains usable when preferences cannot be persisted.
  }
}
