/*
 * BlueMap Create train overlay with BlueMap 5.7 MarkerSet integration.
 * Based on the train overlay shipped with BluemapCreateEntityAddon.
 *
 * Runtime MarkerSets:
 *   - Create 路線図
 *   - Create 列車
 */

// API endpoint can be configured by defining window.CREATE_TRAIN_WEB_API_URL
// before this script is loaded. The default matches CreateTrainWebAPI.
const host = (window.CREATE_TRAIN_WEB_API_URL ?? "http://localhost:8080")
    .replace(/\/+$/, "");

// When true, the overlay is rendered through terrain.
const linesVisibleThroughTerrain = true;
const trainsVisibleThroughTerrain = true;

const mapViewer = window.bluemap.mapViewer;
const renderer = mapViewer.renderer;
const THREE = window.BlueMap.Three;

// Keep the actual overlay rendering in independent scenes and use BlueMap MarkerSets
// as visibility toggles in the built-in Markers menu.
const linesScene = new THREE.Scene();
const trainsScene = new THREE.Scene();

function createToggleMarkerSet(id, label, sorting) {
    const existing = mapViewer.markers.markerSets?.get(id);
    if (existing) {
        existing.data.label = label;
        existing.data.toggleable = true;
        existing.data.sorting = sorting;
        return existing;
    }

    const markerSet = new window.BlueMap.MarkerSet(id, {
        label,
        toggleable: true,
        defaultHidden: false,
        sorting,
        markerSets: {},
        markers: {},
    });
    mapViewer.markers.add(markerSet);
    return markerSet;
}

const routeToggle = createToggleMarkerSet(
    "create-rail-network",
    "Create 路線図",
    100
);
const trainToggle = createToggleMarkerSet(
    "create-trains",
    "Create 列車",
    101
);

// BlueMap 5.7 compatibility:
// NormalMarkerManager refreshes markers.json every 10 seconds and removes
// MarkerSets that are not present in that file. Preserve the two runtime
// MarkerSets created by this script, just like BlueMap preserves bm-players
// and bm-popup-set.
let patchedMarkerFileManager = null;

function patchBlueMap57MarkerManager() {
    const manager = window.bluemap?.markerFileManager;
    if (!manager || manager === patchedMarkerFileManager) return;

    manager.updateFromData = function (markerData) {
        this.root.updateMarkerSetsFromData(markerData, [
            "bm-players",
            "bm-popup-set",
            "create-rail-network",
            "create-trains",
            "create-contraptions",
            "create-vehicles",
            "create-train-labels",
            "create-vehicle-labels",
        ]);
        return true;
    };

    manager.clear = function () {
        this.root.updateMarkerSetsFromData({}, [
            "bm-players",
            "bm-popup-set",
            "create-rail-network",
            "create-trains",
            "create-contraptions",
            "create-vehicles",
            "create-train-labels",
            "create-vehicle-labels",
        ]);
    };

    patchedMarkerFileManager = manager;
    console.log("[CreateTrain] BlueMap 5.7 marker manager patched");
}

patchBlueMap57MarkerManager();

// switchMap() disposes NormalMarkerManager and creates a new instance.
// Re-patch it after a map/world change, and keep a lightweight fallback poll.
window.bluemap?.events?.addEventListener?.("bluemapMapChanged", () => {
    setTimeout(patchBlueMap57MarkerManager, 0);
});
setInterval(patchBlueMap57MarkerManager, 1000);

// Reuse BlueMap's wide-line implementation when available, otherwise use THREE.Line.
let LineClass = THREE.Line;
let LineGeometryClass = THREE.BufferGeometry;
let LineMaterialClass = THREE.LineBasicMaterial;
let useWideLines = false;

try {
    if (window.BlueMap?.LineMarker) {
        const sample = new window.BlueMap.LineMarker("create-train-line-probe");
        // sample.line is a BlueMap subclass; use its Line2 parent class.
        LineClass = Object.getPrototypeOf(sample.line.constructor);
        LineGeometryClass = sample.line.geometry.constructor;
        LineMaterialClass = sample.line.material.constructor;
        sample.dispose?.();
        useWideLines = true;
    }
} catch (err) {
    console.warn("[CreateTrain] BlueMap wide-line backend unavailable; using THREE.Line", err);
}

const resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
const stationGeometry = new THREE.SphereGeometry(1, 16, 16);
const stationMaterial = new THREE.MeshBasicMaterial({ color: 0x00cc00 });
const portalGeometry = new THREE.SphereGeometry(1.2, 16, 16);
const portalMaterial = new THREE.MeshBasicMaterial({ color: 0xbb00ff });

const networkMaterials = new Map();
const networkColors = new Map();

function getNetworkColor(networkId) {
    if (!networkColors.has(networkId)) {
        const hue = (networkColors.size * 137.508) % 360;
        const color = new THREE.Color().setHSL(hue / 360, 0.7, 0.6);
        networkColors.set(networkId, color.getHex());
    }
    return networkColors.get(networkId);
}

function getNetworkMaterial(networkId) {
    if (networkMaterials.has(networkId)) return networkMaterials.get(networkId);

    const options = {
        color: getNetworkColor(networkId),
    };
    if (useWideLines) {
        options.linewidth = 2;
        options.resolution = resolution.clone();
    }

    const material = new LineMaterialClass(options);
    networkMaterials.set(networkId, material);
    return material;
}

const objects = {
    tracks: new Map(),
    stations: new Map(),
    portals: new Map(),
    trains: new Map(),
};

let networkData = null;
let trainsData = [];
let lastTrainState = new Map();
let trainModelCache = new Map();
let trainModelRequests = new Map();
const trainModelRetryAt = new Map();
const edgeToNetwork = new Map();
let networkFetchInFlight = false;

// BlueMap custom map names are not Minecraft dimension ids.
// Use the same dimension inference/overrides as the Sable vehicle overlay.
function currentMapIdentities() {
    const map = mapViewer.map;
    const data = map?.data ?? {};
    const values = [
        data.dimension, data.id, data.key, data.name,
        map?.id, map?.key,
    ].filter(value => typeof value === "string" && value.length > 0)
        .map(value => value.toLocaleLowerCase().trim());
    for (const value of [...values]) {
        const match = /\(([^)]+)\)/.exec(value);
        if (match) values.push(match[1].toLocaleLowerCase().trim());
    }
    return [...new Set(values)];
}

function normalizeMinecraftDimension(dimension) {
    const value = String(dimension ?? "").toLocaleLowerCase().trim();
    if (value.includes("minecraft:the_nether") || value === "nether" || value === "the_nether") {
        return "minecraft:the_nether";
    }
    if (value.includes("minecraft:the_end") || value === "end" || value === "the_end") {
        return "minecraft:the_end";
    }
    if (value.includes("minecraft:overworld") || value === "world" || value === "overworld") {
        return "minecraft:overworld";
    }
    return value;
}

function currentWorldKey() {
    const identities = currentMapIdentities();
    const overrides = window.CREATE_MAP_DIMENSION_OVERRIDES;
    if (overrides && typeof overrides === "object") {
        for (const [key, dimension] of Object.entries(overrides)) {
            if (identities.includes(key.toLocaleLowerCase().trim()) &&
                    typeof dimension === "string" && dimension.length > 0) {
                return normalizeMinecraftDimension(dimension);
            }
        }
    }

    for (const identity of identities) {
        if (identity.includes("nether")) return "minecraft:the_nether";
        if (identity === "end" || identity === "the_end" ||
                /(^|[\\s(_: -])(?:the[_\\s-]+)?end($|[\\s): _-])/.test(identity)) {
            return "minecraft:the_end";
        }
    }
    // A custom primary map title (e.g. "NNSR Craft") is the Overworld.
    return "minecraft:overworld";
}

function dimensionMatchesCurrentMap(dimension) {
    return normalizeMinecraftDimension(dimension) === currentWorldKey();
}

function nodeMapForDimension(dimKey) {
    if (!networkData || !dimKey) return new Map();
    const normalized = normalizeMinecraftDimension(dimKey);
    const nodes = Array.from(networkData.nodes ?? []).filter(node =>
        normalizeMinecraftDimension(node.dimensionLocationData?.dimension) === normalized
    );
    return new Map(nodes.map(node => [node.id, node]));
}

// Allow the train labels overlay to share exactly the same map dimension.
window.CreateTrainDimension = currentWorldKey;
window.CreateTrainDimensionMatch = dimensionMatchesCurrentMap;

function detectNetworks() {
    edgeToNetwork.clear();
    if (!networkData) return;

    const nodes = nodeMapForDimension(currentWorldKey());
    const edges = Array.from(networkData.edges ?? []).filter(edge =>
        nodes.has(edge.node1) && nodes.has(edge.node2)
    );

    const parent = new Map();
    const rank = new Map();

    function find(id) {
        if (!parent.has(id)) {
            parent.set(id, id);
            rank.set(id, 0);
        }
        if (parent.get(id) !== id) parent.set(id, find(parent.get(id)));
        return parent.get(id);
    }

    function unite(a, b) {
        const ra = find(a);
        const rb = find(b);
        if (ra === rb) return;

        const rankA = rank.get(ra) ?? 0;
        const rankB = rank.get(rb) ?? 0;
        if (rankA < rankB) parent.set(ra, rb);
        else if (rankA > rankB) parent.set(rb, ra);
        else {
            parent.set(rb, ra);
            rank.set(ra, rankA + 1);
        }
    }

    edges.forEach(edge => unite(edge.node1, edge.node2));
    edges.forEach(edge => {
        edgeToNetwork.set(`${edge.node1}:${edge.node2}`, find(edge.node1));
        edgeToNetwork.set(`${edge.node2}:${edge.node1}`, find(edge.node1));
    });

    console.log(
        `[CreateTrain] detected ${new Set(edgeToNetwork.values()).size} rail network(s)`
    );
}

function cubicBezier(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return {
        x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
        y: u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y,
        z: u ** 3 * p0.z + 3 * u ** 2 * t * p1.z + 3 * u * t ** 2 * p2.z + t ** 3 * p3.z,
    };
}

function approximateBezierLength(bezier, steps = 50) {
    let length = 0;
    let prev = bezier.p0;
    for (let i = 1; i <= steps; i++) {
        const point = cubicBezier(bezier.p0, bezier.p1, bezier.p2, bezier.p3, i / steps);
        length += Math.hypot(
            point.x - prev.x,
            point.y - prev.y,
            point.z - prev.z
        );
        prev = point;
    }
    return length;
}

function edgeBetween(nodeA, nodeB) {
    return Array.from(networkData?.edges ?? []).find(edge =>
        (edge.node1 === nodeA.id && edge.node2 === nodeB.id) ||
        (edge.node1 === nodeB.id && edge.node2 === nodeA.id)
    ) ?? null;
}

function pointOnEdge(nodeA, nodeB, distance, edge) {
    if (edge?.bezierConnection) {
        const bezier = edge.bezierConnection;
        const total = approximateBezierLength(bezier) || 1;
        const t = Math.max(0, Math.min(1, (distance ?? 0) / total));
        const reversed = nodeA.id === edge.node2 && nodeB.id === edge.node1;
        return reversed
            ? cubicBezier(bezier.p3, bezier.p2, bezier.p1, bezier.p0, t)
            : cubicBezier(bezier.p0, bezier.p1, bezier.p2, bezier.p3, t);
    }

    const a = nodeA.dimensionLocationData.location;
    const b = nodeB.dimensionLocationData.location;
    const total = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
    const t = Math.max(0, Math.min(1, (distance ?? 0) / total));
    return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
    };
}

function makeTrackLine(points, material) {
    const geometry = new LineGeometryClass();
    const flat = points.flatMap(p => [p.x, p.y, p.z]);

    if (useWideLines && typeof geometry.setPositions === "function") {
        geometry.setPositions(flat);
    } else if (typeof geometry.setFromPoints === "function") {
        geometry.setFromPoints(points.map(p => new THREE.Vector3(p.x, p.y, p.z)));
    }

    return new LineClass(geometry, material);
}

function clearSceneObjects(kind, scene) {
    objects[kind].forEach(obj => {
        scene.remove(obj);
        obj.geometry?.dispose?.();
    });
    objects[kind].clear();
}

function renderTracks() {
    clearSceneObjects("tracks", linesScene);
    if (!networkData) return;

    const nodes = nodeMapForDimension(currentWorldKey());
    const edges = Array.from(networkData.edges ?? []).filter(edge =>
        nodes.has(edge.node1) && nodes.has(edge.node2)
    );

    edges.forEach(edge => {
        let points;
        if (edge.bezierConnection) {
            points = [];
            for (let i = 0; i <= 32; i++) {
                points.push(cubicBezier(
                    edge.bezierConnection.p0,
                    edge.bezierConnection.p1,
                    edge.bezierConnection.p2,
                    edge.bezierConnection.p3,
                    i / 32
                ));
            }
        } else {
            points = [
                nodes.get(edge.node1).dimensionLocationData.location,
                nodes.get(edge.node2).dimensionLocationData.location,
            ];
        }

        const networkId = edgeToNetwork.get(`${edge.node1}:${edge.node2}`) ?? "default";
        const line = makeTrackLine(points, getNetworkMaterial(networkId));
        linesScene.add(line);
        objects.tracks.set(`${edge.node1}:${edge.node2}`, line);
    });
}

function renderStations() {
    objects.stations.forEach(obj => linesScene.remove(obj));
    objects.stations.clear();
    if (!networkData?.stations) return;

    const nodes = nodeMapForDimension(currentWorldKey());

    networkData.stations.forEach(station => {
        const node1Id = station.node1?.id ?? station.node1;
        const node2Id = station.node2?.id ?? station.node2;
        const node1 = nodes.get(node1Id);
        const node2 = nodes.get(node2Id);
        if (!node1 || !node2) return;

        const edge = edgeBetween(node1, node2);
        const pos = pointOnEdge(node1, node2, station.positionOnTrack ?? 0, edge);
        const mesh = new THREE.Mesh(stationGeometry, stationMaterial);
        mesh.position.set(pos.x, pos.y, pos.z);
        linesScene.add(mesh);
        objects.stations.set(station.id, mesh);
    });
}

function renderPortals() {
    objects.portals.forEach(obj => linesScene.remove(obj));
    objects.portals.clear();

    const nodes = nodeMapForDimension(currentWorldKey());
    nodes.forEach(node => {
        if (!node.interDimensional) return;
        const pos = node.dimensionLocationData.location;
        const mesh = new THREE.Mesh(portalGeometry, portalMaterial);
        mesh.position.set(pos.x, pos.y + 2, pos.z);
        linesScene.add(mesh);
        objects.portals.set(node.id, mesh);
    });
}

async function fetchAndRenderNetwork() {
    if (networkFetchInFlight) return;
    networkFetchInFlight = true;
    try {
        const response = await fetch(`${host}/network`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const received = await response.json();
        if (!Array.isArray(received?.nodes)) throw new Error("Invalid railway network response");
        networkData = received;
        detectNetworks();
        renderTracks();
        renderStations();
        renderPortals();
        updateTrainStates();
        console.info(
            "[CreateTrain] network loaded:",
            networkData.nodes.length,
            "nodes,",
            nodeMapForDimension(currentWorldKey()).size,
            "in",
            currentWorldKey()
        );
    } catch (err) {
        console.warn("[CreateTrain] network fetch failed; will retry", err);
    } finally {
        networkFetchInFlight = false;
    }
}

function updateTrainStates() {
    if (!networkData) return;

    const now = performance.now();
    const nodes = nodeMapForDimension(currentWorldKey());

    trainsData.forEach(train => {
        if (!Array.isArray(train.cars)) return;

        const previous = lastTrainState.get(train.id) ?? { cars: [] };
        const nextCars = [];

        train.cars.forEach((car, carIndex) => {
            const frontA = nodes.get(car.node1);
            const frontB = nodes.get(car.node2);
            const backA = nodes.get(car.node3);
            const backB = nodes.get(car.node4);
            if (!frontA || !frontB || !backA || !backB) return;

            const front = pointOnEdge(frontA, frontB, car.positionOnTrack, edgeBetween(frontA, frontB));
            const back = pointOnEdge(backA, backB, car.trailingPositionOnTrack, edgeBetween(backA, backB));
            const old = previous.cars[carIndex];
            const sameDimension = old?.dimension === frontA.dimensionLocationData.dimension;

            nextCars[carIndex] = {
                startFront: sameDimension ? (old.endFront ?? front) : front,
                endFront: front,
                startBack: sameDimension ? (old.endBack ?? back) : back,
                endBack: back,
                startTime: now,
                endTime: sameDimension ? now + 200 : now,
                dimension: frontA.dimensionLocationData.dimension,
            };
        });

        lastTrainState.set(train.id, { cars: nextCars, time: now });
    });

    renderTrainMeshes();
}

function interpolatedCar(state, now) {
    if (!state) return null;
    const duration = Math.max(1, state.endTime - state.startTime);
    const t = Math.max(0, Math.min(1, (now - state.startTime) / duration));

    const front = {
        x: state.startFront.x + (state.endFront.x - state.startFront.x) * t,
        y: state.startFront.y + (state.endFront.y - state.startFront.y) * t,
        z: state.startFront.z + (state.endFront.z - state.startFront.z) * t,
    };
    const back = {
        x: state.startBack.x + (state.endBack.x - state.startBack.x) * t,
        y: state.startBack.y + (state.endBack.y - state.startBack.y) * t,
        z: state.startBack.z + (state.endBack.z - state.startBack.z) * t,
    };

    return {
        pos: front,
        tangent: {
            x: front.x - back.x,
            y: front.y - back.y,
            z: front.z - back.z,
        },
    };
}

function orientMesh(mesh, pos, tangent) {
    mesh.position.set(pos.x, pos.y + 1, pos.z);

    const forward = new THREE.Vector3(tangent.x, tangent.y, tangent.z);
    if (forward.lengthSq() < 1e-10) return;
    forward.normalize();

    const worldUp = new THREE.Vector3(0, 1, 0);
    let right = new THREE.Vector3().crossVectors(worldUp, forward);
    if (right.lengthSq() < 1e-10) right = new THREE.Vector3(1, 0, 0);
    right.normalize();

    const correctedUp = new THREE.Vector3().crossVectors(forward, right).normalize();
    const matrix = new THREE.Matrix4().makeBasis(right, correctedUp, forward);
    mesh.quaternion.setFromRotationMatrix(matrix);
}

function modelUrl(trainId, carIndex) {
    return `${host}/trainModels/${trainId}_${carIndex}.prbm`;
}

function findLoadedBlueMap() {
    let found = null;
    window.bluemap.maps?.forEach(map => {
        if (!found && map.hiresTileManager) found = map;
    });
    return found;
}

async function loadTrainModel(url, direction) {
    if (trainModelCache.has(url)) {
        const existing = trainModelCache.get(url);
        if (existing || Date.now() < (trainModelRetryAt.get(url) ?? 0)) return existing;
        trainModelCache.delete(url);
    }
    if (trainModelRequests.has(url)) return trainModelRequests.get(url);

    const task = (async () => {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const map = findLoadedBlueMap();
            if (!map) throw new Error("No loaded BlueMap map found");

            const buffer = await response.arrayBuffer();
            const loader = map.hiresTileManager.tileLoader.bufferGeometryLoader;
            const geometry = loader.parse(buffer);
            rotateGeometryToDirection(geometry, direction);

            let material = map.hiresMaterial;
            if (!material) {
                material = geometry.getAttribute("color")
                    ? new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true })
                    : new THREE.MeshStandardMaterial({ color: 0x3366cc, flatShading: true });
            }

            const model = { geometry, material };
            trainModelCache.set(url, model);
            trainModelRetryAt.delete(url);
            return model;
        } catch (err) {
            console.debug(`[CreateTrain] train model unavailable: ${url}; retrying later`, err);
            trainModelCache.set(url, null);
            trainModelRetryAt.set(url, Date.now() + 10000);
            return null;
        } finally {
            trainModelRequests.delete(url);
        }
    })();

    trainModelRequests.set(url, task);
    return task;
}

function ensureTrainModels() {
    trainsData.forEach(train => {
        (train.cars ?? []).forEach((car, carIndex) => {
            const url = modelUrl(train.id, carIndex);
            const retryExpired = trainModelCache.has(url) &&
                trainModelCache.get(url) === null &&
                Date.now() >= (trainModelRetryAt.get(url) ?? 0);
            if ((!trainModelCache.has(url) || retryExpired) && !trainModelRequests.has(url)) {
                loadTrainModel(url, car.assemblyDirection ?? "SOUTH").then(() => {
                    renderTrainMeshes();
                });
            }
        });
    });
}

function renderTrainMeshes() {
    const wanted = new Set();

    trainsData.forEach(train => {
        const state = lastTrainState.get(train.id);
        if (!state) return;

        (train.cars ?? []).forEach((car, carIndex) => {
            const carState = state.cars[carIndex];
            if (!carState?.dimension || !dimensionMatchesCurrentMap(carState.dimension)) return;

            const key = `${train.id}:${carIndex}`;
            wanted.add(key);

            const url = modelUrl(train.id, carIndex);
            const model = trainModelCache.get(url);
            const existing = objects.trains.get(key);

            // Replace a fallback box if the real model finishes loading later.
            if (existing) {
                if (model && existing.userData.createTrainFallback) {
                    trainsScene.remove(existing);
                    existing.geometry?.dispose?.();
                    existing.material?.dispose?.();
                    objects.trains.delete(key);
                } else {
                    return;
                }
            }

            let mesh;
            if (model) {
                mesh = new THREE.Mesh(model.geometry, model.material);
                mesh.userData.createTrainFallback = false;
            } else {
                mesh = new THREE.Mesh(
                    new THREE.BoxGeometry(5, 2, 2),
                    new THREE.MeshBasicMaterial({ color: 0x3366cc })
                );
                mesh.userData.createTrainFallback = true;
            }

            trainsScene.add(mesh);
            objects.trains.set(key, mesh);
        });
    });

    objects.trains.forEach((mesh, key) => {
        if (wanted.has(key)) return;
        trainsScene.remove(mesh);
        if (mesh.userData.createTrainFallback) {
            mesh.geometry?.dispose?.();
            mesh.material?.dispose?.();
        }
        objects.trains.delete(key);
    });
}

function animateTrains() {
    if (!trainToggle.visible) return;

    const now = performance.now();

    trainsData.forEach(train => {
        const state = lastTrainState.get(train.id);
        if (!state) return;

        (train.cars ?? []).forEach((car, carIndex) => {
            const carState = state.cars[carIndex];
            if (!carState?.dimension || !dimensionMatchesCurrentMap(carState.dimension)) return;

            const mesh = objects.trains.get(`${train.id}:${carIndex}`);
            if (!mesh) return;

            const interpolated = interpolatedCar(carState, now);
            if (interpolated) orientMesh(mesh, interpolated.pos, interpolated.tangent);
        });
    });
}

function connectTrainStream() {
    const source = new EventSource(`${host}/trainsLive`);

    source.onmessage = event => {
        try {
            trainsData = JSON.parse(event.data);
            ensureTrainModels();
            updateTrainStates();
        } catch (err) {
            console.error("[CreateTrain] invalid train update", err);
        }
    };

    source.onerror = event => {
        console.error("[CreateTrain] SSE error", event);
    };

    return source;
}

function rotateGeometryToDirection(geometry, assemblyDirection, targetDirection = "NORTH") {
    const angles = {
        NORTH: 0,
        EAST: -Math.PI / 2,
        SOUTH: -Math.PI,
        WEST: Math.PI / 2,
    };

    const angle = (angles[targetDirection] ?? 0) - (angles[assemblyDirection] ?? 0);
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationY(angle));

    const offsets = {
        NORTH: { x: -0.5, y: 0, z: -1.5 },
        EAST: { x: -0.5, y: 0, z: -0.5 },
        SOUTH: { x: 0.5, y: 0, z: -0.5 },
        WEST: { x: 0.5, y: 0, z: -1.5 },
    };
    const offset = offsets[assemblyDirection] ?? { x: 0, y: 0, z: 0 };
    geometry.applyMatrix4(
        new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z)
    );
}

function renderOverlayLoop() {
    animateTrains();

    const contraptions = window.CreateContraptionOverlay;
    const vehicles = window.CreateVehicleOverlay;
    contraptions?.animate?.();
    vehicles?.animate?.();

    const camera = mapViewer.camera;
    const showLines = routeToggle.visible;
    const showTrains = trainToggle.visible;
    const showContraptions = contraptions?.toggle?.visible ?? false;
    const showVehicles = vehicles?.toggle?.visible ?? false;
    const contraptionsThroughTerrain =
        window.CREATE_CONTRAPTIONS_THROUGH_TERRAIN ?? false;
    const vehiclesThroughTerrain =
        window.CREATE_VEHICLES_THROUGH_TERRAIN ?? false;

    // Render depth-tested elements first.
    if (showLines && !linesVisibleThroughTerrain) renderer.render(linesScene, camera);
    if (showTrains && !trainsVisibleThroughTerrain) renderer.render(trainsScene, camera);
    if (showContraptions && !contraptionsThroughTerrain) {
        renderer.render(contraptions.scene, camera);
    }
    if (showVehicles && !vehiclesThroughTerrain) {
        renderer.render(vehicles.scene, camera);
    }

    // Render through-terrain elements after clearing the depth buffer.
    if (
        (showLines && linesVisibleThroughTerrain) ||
        (showTrains && trainsVisibleThroughTerrain) ||
        (showContraptions && contraptionsThroughTerrain) ||
        (showVehicles && vehiclesThroughTerrain)
    ) {
        renderer.clearDepth();
        if (showLines && linesVisibleThroughTerrain) renderer.render(linesScene, camera);
        if (showTrains && trainsVisibleThroughTerrain) renderer.render(trainsScene, camera);
        if (showContraptions && contraptionsThroughTerrain) {
            renderer.render(contraptions.scene, camera);
        }
        if (showVehicles && vehiclesThroughTerrain) {
            renderer.render(vehicles.scene, camera);
        }
    }

    requestAnimationFrame(renderOverlayLoop);
}

window.addEventListener("resize", () => {
    resolution.set(window.innerWidth, window.innerHeight);
    networkMaterials.forEach(material => {
        if (material.resolution) material.resolution.copy(resolution);
        material.needsUpdate = true;
    });
});

let lastWorld = "";
setInterval(() => {
    const current = currentWorldKey();
    if (!current || current === lastWorld) return;

    lastWorld = current;
    fetchAndRenderNetwork();
    updateTrainStates();
}, 500);

// Recover if the first /network request happened before the server was ready.
setInterval(() => {
    if (!networkData || (trainsData.length > 0 &&
            nodeMapForDimension(currentWorldKey()).size === 0)) {
        fetchAndRenderNetwork();
    }
    ensureTrainModels();
}, 10000);

window.CreateTrainDiagnostics = () => ({
    mapName: mapViewer.map?.data?.name ?? null,
    mapIdentities: currentMapIdentities(),
    dimension: currentWorldKey(),
    networkNodes: networkData?.nodes?.length ?? null,
    dimensionNodes: nodeMapForDimension(currentWorldKey()).size,
    trainCount: trainsData.length,
    trainIds: trainsData.map(train => train.id),
    positionedCarriages: [...lastTrainState.values()].reduce(
        (count, state) => count + state.cars.filter(Boolean).length, 0
    ),
    renderedCarriages: objects.trains.size,
    labelsSetPresent: mapViewer.markers.markerSets?.has("create-train-labels") ?? false,
    trainSetVisible: trainToggle.visible,
});

async function waitForMap() {
    while (!mapViewer.map?.data?.name) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

async function startCreateTrainOverlay() {
    await waitForMap();
    lastWorld = currentWorldKey();
    await fetchAndRenderNetwork();
    connectTrainStream();
    renderOverlayLoop();
    console.log("[CreateTrain] overlay started");
}

// Keep BlueMap itself redrawing continuously as well.
try {
    Object.defineProperty(mapViewer, "lastRedrawChange", {
        configurable: true,
        get: () => Date.now(),
        set: () => {},
    });
} catch (err) {
    console.debug("[CreateTrain] lastRedrawChange hook could not be installed", err);
}

startCreateTrainOverlay();
