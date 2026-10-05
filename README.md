# CreateWebAPI

CreateWebAPI exposes Create railway and moving-contraption state over HTTP/SSE for web integrations such as BlueMap. This branch targets NeoForge 1.21.1 and keeps the existing CreateTrainWebAPI endpoints compatible.

## Endpoints

| Path | Purpose |
| --- | --- |
| `/network` | Create railway network data |
| `/trains` | Current train snapshot |
| `/trainsLive` | Live train SSE stream, 200 ms cadence |
| `/trainModels/...` | Existing PRBM train models |
| `/contraptions` | Current non-train Create contraption snapshot |
| `/contraptionsLive` | Live non-train contraption SSE stream, 200 ms cadence |
| `/contraptionModels/<modelId>` | Block-model JSON for a live contraption |

Train carriage contraptions are intentionally excluded from `/contraptions*` because they are already handled by the dedicated train endpoints.

Contraption snapshots are captured on the Minecraft server thread every four ticks and then served from immutable cached data, so HTTP workers do not read live game entities directly. Model IDs are SHA-256 hashes of the contraption block layout, allowing identical vehicles to share one model payload.

## BlueMap integration

The BlueMap 5.7 integration consists of:

- `bluemap/train.js` — railway and live 3D train overlay
- `bluemap/contraptions.js` — live Create contraption overlay
- `bluemap/train-settings.js` — optional drawing-settings GUI
- `bluemap/train-labels.js` — optional live train-name markers
- `bluemap/create-train-bootstrap.js` — deterministic script loader for BlueMap 5.7

The built-in **Markers** menu gains:

- `Create 路線図`
- `Create 列車`
- `Create カラクリ`
- `Create 列車名` when `train-labels.js` is present

`contraptions.js` renders the block layout of each moving contraption as an instanced voxel model and follows Create's exact rotation basis. This makes cars, aircraft, ships, minecart contraptions, gantries and other non-train `AbstractContraptionEntity` instances visible in BlueMap. Non-full-cube block shapes are currently represented by their one-block voxel footprint.

### BlueMap 5.7 script ordering

BlueMap 5.7 stores custom script URLs in an unordered collection, so configure BlueMap to load only the bootstrap. The bootstrap loads the integration in this order:

1. `create-train-config.js` if present
2. `train.js`
3. `contraptions.js`
4. `train-settings.js` if present
5. `train-labels.js` if present

Copy the scripts you want from `bluemap/` into the BlueMap web root, then configure `webapp.conf`:

```hocon
scripts: [
    "create-train-bootstrap.js"
]
```

For a remotely hosted BlueMap, copy the example configuration:

```bash
cp create-train-config.example.js create-train-config.js
```

Example:

```js
window.CREATE_TRAIN_WEB_API_URL = "https://create-api.example.com";
window.CREATE_TRAIN_LABEL_MAX_DISTANCE = 4096;
window.CREATE_TRAIN_LINES_THROUGH_TERRAIN = true;
window.CREATE_TRAIN_TRAINS_THROUGH_TERRAIN = false;
window.CREATE_CONTRAPTIONS_THROUGH_TERRAIN = false;
```

If BlueMap is served over HTTPS, expose the API over HTTPS too to avoid browser mixed-content blocking.

### Drawing settings

`train-settings.js` adds `Create 描画設定` to the BlueMap side menu. It controls whether railway lines, trains and contraptions are rendered through terrain. Visibility itself remains controlled from BlueMap's **Markers** menu.

## Server installation

1. Build this branch with Java 21 using `./gradlew build`, or download the successful GitHub Actions build artifact.
2. Replace the older CreateTrainWebAPI jar in the Minecraft server `mods/` directory with the jar produced by this branch.
3. Keep Create and its existing dependencies installed.
4. Start the server once and verify the web API port in the generated config.
5. Open `http://<server>:8080/contraptions` to verify that moving non-train contraptions are being returned.
6. Copy the BlueMap scripts described above into the BlueMap web root and hard-refresh the browser.

Default server configuration:

```hocon
serverPort = 8080
serverHost = "0.0.0.0"
trainModelPath = "bluemap/train_models/"
```

The existing `trainModelPath` remains only for PRBM train models. Contraption models are generated in memory from Create's live block data and are served through `/contraptionModels/<modelId>`.
