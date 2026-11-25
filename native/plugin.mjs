import { inertPluginInstance } from "@geastack/compiler/plugin";
import { fileURLToPath } from "node:url";

export const geatscPlugin = () => ({
  name: "yule-native",
  instantiate() {
    const header = fileURLToPath(new URL("./snow-stamp.h", import.meta.url));
    return {
      ...inertPluginInstance,
      capabilities: {
        ...inertPluginInstance.capabilities,
        hostFunctions: new Map([
          ["stampSnowBatch", "yule::stampSnowBatch"],
          ["restoreSnowTiles", "yule::restoreSnowTiles"],
          ["glowSprite", "yule::glowSprite"],
          ["blendSprite", "yule::blendSprite"],
          ["restoreMarks", "yule::restoreMarks"],
        ]),
        hostPreambles: new Map([
          ["yule::stampSnowBatch", [`#include ${JSON.stringify(header)}`]],
          ["yule::restoreSnowTiles", [`#include ${JSON.stringify(header)}`]],
          ["yule::glowSprite", [`#include ${JSON.stringify(header)}`]],
          ["yule::blendSprite", [`#include ${JSON.stringify(header)}`]],
          ["yule::restoreMarks", [`#include ${JSON.stringify(header)}`]],
        ]),
      },
    };
  },
});
