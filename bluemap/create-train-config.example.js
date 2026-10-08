/*
 * Example environment-specific configuration for the BlueMap integration.
 *
 * Copy this file to "create-train-config.js" in your BlueMap web root and
 * customize the values for your environment. The real config file is ignored
 * by Git so deployment-specific URLs are not committed accidentally.
 */

window.CREATE_TRAIN_WEB_API_URL = "https://train-api.example.com";

// Train-name labels fade out with distance and are fully hidden at this value.
window.CREATE_TRAIN_LABEL_MAX_DISTANCE = 4096;

// Default drawing settings. Users can still change these in the BlueMap UI.
window.CREATE_TRAIN_LINES_THROUGH_TERRAIN = true;
window.CREATE_TRAIN_TRAINS_THROUGH_TERRAIN = false;
window.CREATE_CONTRAPTIONS_THROUGH_TERRAIN = false;
window.CREATE_VEHICLES_THROUGH_TERRAIN = false;


// Optional: map BlueMap ids/names to Minecraft dimensions when using custom
// names or modded dimensions. Keys are matched case-insensitively.
// window.CREATE_MAP_DIMENSION_OVERRIDES = {
//     "nnsr craft": "minecraft:overworld",
//     "nnsr nether": "minecraft:the_nether",
//     "nnsr end": "minecraft:the_end",
// };
