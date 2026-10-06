/*
 * Live Sable physics vehicle overlay for BlueMap 5.7.
 *
 * Textured vehicle geometry uses the same PRBM + hiresMaterial path as trains.
 * JSON voxel rendering remains as a temporary fallback when PRBM generation is
 * unavailable during startup or for an unsupported block/model.
 *
 * Consumes:
 *   - /vehiclesLive
 *   - /vehicleModels/<modelId>.prbm
 *   - /vehicleModels/<modelId> (fallback JSON)
 */
(() => {
    if (window.__createVehicleOverlayInstalled) return;
    window.__createVehicleOverlayInstalled = true;

    const host = (window.CREATE_TRAIN_WEB_API_URL ?? "http://localhost:8080")
        .replace(/\/+$/, "");

    const PRBM_RETRY_MS = 10000;

    const mapViewer = window.bluemap?.mapViewer;
    const renderer = mapViewer?.renderer;
    const THREE = window.BlueMap?.Three;

    if (!mapViewer || !renderer || !THREE || !window.BlueMap?.MarkerSet) {
        console.error("[CreateVehicles] BlueMap renderer API is unavailable");
        return;
    }

    const scene = new THREE.Scene();
    const objects = new Map();
    const liveStates = new Map();

    // modelCache values:
    //   { kind: "prbm", geometry }
    //   { kind: "voxel", data, retryAt }
    const modelCache = new Map();
    const modelRequests = new Map();

    const sharedCubeGeometry = new THREE.BoxGeometry(1, 1, 1);
    const materialCache = new Map();

    function createToggleMarkerSet() {
        const id = "create-vehicles";
        const existing = mapViewer.markers.markerSets?.get(id);
        if (existing) {
            existing.data.label = "Create 乗り物";
            existing.data.toggleable = true;
            existing.data.sorting = 103;
            return existing;
        }

        const markerSet = new window.BlueMap.MarkerSet(id, {
            label: "Create 乗り物",
            toggleable: true,
            defaultHidden: false,
            sorting: 103,
            markerSets: {},
            markers: {},
        });
        mapViewer.markers.add(markerSet);
        return markerSet;
    }

    const toggle = createToggleMarkerSet();
    mapViewer.markers.__createTrainRuntimeMarkerSets?.add?.("create-vehicles");

    function currentMapIdentities() {
        const map = mapViewer.map;
        const data = map?.data ?? {};
        const values = [
            data.name,
            data.world,
            data.dimension,
            data.id,
            data.key,
            map?.id,
            map?.key,
        ]
            .filter(value => typeof value === "string" && value.length > 0)
            .map(value => value.toLocaleLowerCase());

        for (const value of [...values]) {
            const match = /\((?<name>.*)\)/.exec(value);
            if (match?.groups?.name) values.push(match.groups.name.toLocaleLowerCase());
        }

        return [...new Set(values)];
    }

    function configuredDimensionForCurrentMap() {
        const overrides = window.CREATE_MAP_DIMENSION_OVERRIDES;
        if (!overrides || typeof overrides !== "object") return null;

        for (const identity of currentMapIdentities()) {
            const configured = overrides[identity];
            if (typeof configured === "string" && configured.length > 0) {
                return configured.toLocaleLowerCase();
            }
        }

        return null;
    }

    function inferredDimensionForCurrentMap() {
        const configured = configuredDimensionForCurrentMap();
        if (configured) return configured;

        const identities = currentMapIdentities();
        if (identities.some(identity => identity.includes("nether"))) {
            return "minecraft:the_nether";
        }
        if (identities.some(identity =>
            identity === "end" ||
            identity.includes("the_end") ||
            identity.includes("the end")
        )) {
            return "minecraft:the_end";
        }

        return "minecraft:overworld";
    }

    function dimensionMatchesCurrentMap(dimension) {
        const dim = String(dimension ?? "").toLocaleLowerCase();
        if (!dim) return false;

        const identities = currentMapIdentities();
        if (identities.some(identity =>
            dim.includes(identity) || identity.includes(dim)
        )) {
            return true;
        }

        return dim === inferredDimensionForCurrentMap();
    }

    function findLoadedBlueMap() {
        if (mapViewer.map?.hiresTileManager) {
            return mapViewer.map;
        }

        let found = null;
        window.bluemap?.maps?.forEach?.(map => {
            if (!found && map.hiresTileManager) found = map;
        });
        return found;
    }

    function colorForBlock(blockId) {
        let hash = 2166136261;
        for (let i = 0; i < blockId.length; i++) {
            hash ^= blockId.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }

        const hue = ((hash >>> 0) % 360) / 360;
        return new THREE.Color().setHSL(hue, 0.45, 0.56);
    }

    function materialForBlock(blockId) {
        if (!materialCache.has(blockId)) {
            materialCache.set(
                blockId,
                new THREE.MeshBasicMaterial({ color: colorForBlock(blockId) })
            );
        }

        return materialCache.get(blockId);
    }

    async function loadJsonFallback(modelId) {
        const response = await fetch(
            `${host}/vehicleModels/${encodeURIComponent(modelId)}`
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }

    async function loadModel(modelId, dimension) {
        const cached = modelCache.get(modelId);
        if (
            cached &&
            !(cached.kind === "voxel" && Date.now() >= cached.retryAt)
        ) {
            return cached;
        }

        if (modelRequests.has(modelId)) return modelRequests.get(modelId);

        const request = (async () => {
            try {
                const prbmUrl =
                    `${host}/vehicleModels/${encodeURIComponent(modelId)}.prbm` +
                    `?dimension=${encodeURIComponent(dimension ?? "")}`;

                const response = await fetch(prbmUrl);
                if (!response.ok) throw new Error(`PRBM HTTP ${response.status}`);

                const map = findLoadedBlueMap();
                const loader = map?.hiresTileManager?.tileLoader?.bufferGeometryLoader;
                if (!loader) {
                    throw new Error("BlueMap PRBM geometry loader is unavailable");
                }

                const buffer = await response.arrayBuffer();
                const geometry = loader.parse(buffer);
                const model = { kind: "prbm", geometry };
                modelCache.set(modelId, model);

                console.log(
                    `[CreateVehicles] textured PRBM loaded: ${modelId}`
                );
                return model;
            } catch (prbmError) {
                console.debug(
                    `[CreateVehicles] PRBM unavailable for ${modelId}; using voxel fallback`,
                    prbmError
                );

                try {
                    const data = await loadJsonFallback(modelId);
                    const model = {
                        kind: "voxel",
                        data,
                        retryAt: Date.now() + PRBM_RETRY_MS,
                    };
                    modelCache.set(modelId, model);
                    return model;
                } catch (jsonError) {
                    console.error(
                        `[CreateVehicles] failed to load vehicle model ${modelId}`,
                        jsonError
                    );
                    modelCache.delete(modelId);
                    return null;
                }
            } finally {
                modelRequests.delete(modelId);
            }
        })();

        modelRequests.set(modelId, request);
        return request;
    }

    function buildVoxelModel(model) {
        const group = new THREE.Group();
        group.position.set(
            Number(model.originOffsetX ?? 0),
            Number(model.originOffsetY ?? 0),
            Number(model.originOffsetZ ?? 0)
        );

        const byBlock = new Map();
        for (const block of model.blocks ?? []) {
            if (!byBlock.has(block.block)) byBlock.set(block.block, []);
            byBlock.get(block.block).push(block);
        }

        if (typeof THREE.InstancedMesh === "function") {
            const matrix = new THREE.Matrix4();

            byBlock.forEach((blocks, blockId) => {
                const mesh = new THREE.InstancedMesh(
                    sharedCubeGeometry,
                    materialForBlock(blockId),
                    blocks.length
                );

                blocks.forEach((block, index) => {
                    matrix.makeTranslation(
                        block.x + 0.5,
                        block.y + 0.5,
                        block.z + 0.5
                    );
                    mesh.setMatrixAt(index, matrix);
                });

                mesh.instanceMatrix.needsUpdate = true;
                mesh.frustumCulled = false;
                group.add(mesh);
            });

            return group;
        }

        byBlock.forEach((blocks, blockId) => {
            const material = materialForBlock(blockId);
            blocks.forEach(block => {
                const mesh = new THREE.Mesh(sharedCubeGeometry, material);
                mesh.position.set(
                    block.x + 0.5,
                    block.y + 0.5,
                    block.z + 0.5
                );
                group.add(mesh);
            });
        });

        return group;
    }

    function buildPrbmModel(model) {
        const map = findLoadedBlueMap();
        let material = map?.hiresMaterial;

        if (!material) {
            material = model.geometry.getAttribute("color")
                ? new THREE.MeshStandardMaterial({
                    vertexColors: true,
                    flatShading: true,
                })
                : new THREE.MeshStandardMaterial({
                    color: 0x55aacc,
                    flatShading: true,
                });
        }

        const mesh = new THREE.Mesh(model.geometry, material);
        mesh.frustumCulled = false;
        mesh.userData.createVehiclePrbm = true;
        return mesh;
    }

    function buildFallbackModel() {
        const group = new THREE.Group();
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(6, 3, 6),
            new THREE.MeshBasicMaterial({
                color: 0x00b7ff,
                wireframe: true,
            })
        );

        group.add(mesh);
        group.userData.createVehicleFallback = true;
        return group;
    }

    function buildRenderableModel(model) {
        if (!model) return buildFallbackModel();
        if (model.kind === "prbm") return buildPrbmModel(model);
        if (model.kind === "voxel") return buildVoxelModel(model.data);
        return buildFallbackModel();
    }

    function createRenderable(data) {
        const root = new THREE.Group();
        root.userData.modelId = data.modelId;

        root.add(buildRenderableModel(modelCache.get(data.modelId)));

        scene.add(root);
        return root;
    }

    function replaceRenderableModel(root, modelId) {
        let replacement;
        try {
            replacement = buildRenderableModel(modelCache.get(modelId));
        } catch (error) {
            console.error(
                `[CreateVehicles] failed to build renderable model ${modelId}`,
                error
            );
            return;
        }

        while (root.children.length) {
            root.remove(root.children[0]);
        }

        root.add(replacement);
        root.userData.modelId = modelId;
    }

    function quaternionFromData(data) {
        const quaternion = new THREE.Quaternion(
            Number(data.quaternionX ?? 0),
            Number(data.quaternionY ?? 0),
            Number(data.quaternionZ ?? 0),
            Number(data.quaternionW ?? 1)
        );

        if (
            !Number.isFinite(quaternion.x) ||
            !Number.isFinite(quaternion.y) ||
            !Number.isFinite(quaternion.z) ||
            !Number.isFinite(quaternion.w) ||
            quaternion.lengthSq() < 1e-10
        ) {
            return new THREE.Quaternion();
        }

        return quaternion.normalize();
    }

    function scaleFromData(data) {
        return new THREE.Vector3(
            Number(data.scaleX ?? 1),
            Number(data.scaleY ?? 1),
            Number(data.scaleZ ?? 1)
        );
    }

    function ensureModelLoad(item) {
        const cached = modelCache.get(item.modelId);
        const needsRetry =
            cached?.kind === "voxel" && Date.now() >= cached.retryAt;

        if (
            (cached && !needsRetry) ||
            modelRequests.has(item.modelId)
        ) {
            return;
        }

        if (needsRetry) {
            modelCache.delete(item.modelId);
        }

        loadModel(item.modelId, item.dimension).then(model => {
            if (!model) return;

            liveStates.forEach((state, id) => {
                if (state.data.modelId !== item.modelId) return;

                const root = objects.get(id);
                if (root && root.userData.modelId === item.modelId) {
                    replaceRenderableModel(root, item.modelId);
                }
            });
        });
    }

    function updateLiveStates(data) {
        const now = performance.now();
        const seen = new Set();

        for (const item of data) {
            seen.add(item.id);

            const endPosition = new THREE.Vector3(item.x, item.y, item.z);
            const endQuaternion = quaternionFromData(item);
            const endScale = scaleFromData(item);
            const previous = liveStates.get(item.id);

            const startPosition = previous
                ? previous.endPosition.clone()
                : endPosition.clone();
            const startQuaternion = previous
                ? previous.endQuaternion.clone()
                : endQuaternion.clone();
            const startScale = previous
                ? previous.endScale.clone()
                : endScale.clone();

            liveStates.set(item.id, {
                data: item,
                startPosition,
                endPosition,
                startQuaternion,
                endQuaternion,
                startScale,
                endScale,
                startTime: now,
                endTime: previous && item.loaded ? now + 200 : now,
            });

            ensureModelLoad(item);
        }

        for (const id of [...liveStates.keys()]) {
            if (!seen.has(id)) liveStates.delete(id);
        }

        syncRenderables();
    }

    function syncRenderables() {
        const wanted = new Set();

        liveStates.forEach((state, id) => {
            const item = state.data;
            if (!dimensionMatchesCurrentMap(item.dimension)) return;

            wanted.add(id);

            let root = objects.get(id);
            if (!root) {
                root = createRenderable(item);
                objects.set(id, root);
            } else if (root.userData.modelId !== item.modelId) {
                replaceRenderableModel(root, item.modelId);
            }
        });

        objects.forEach((root, id) => {
            if (wanted.has(id)) return;
            scene.remove(root);
            objects.delete(id);
        });
    }

    function refreshMaterialsForCurrentMap() {
        objects.forEach(root => {
            replaceRenderableModel(root, root.userData.modelId);
        });
    }

    function animate() {
        if (!toggle.visible) return;

        const now = performance.now();

        liveStates.forEach((state, id) => {
            if (!dimensionMatchesCurrentMap(state.data.dimension)) return;

            const root = objects.get(id);
            if (!root) return;

            const duration = Math.max(1, state.endTime - state.startTime);
            const t = Math.max(0, Math.min(1, (now - state.startTime) / duration));

            root.position
                .copy(state.startPosition)
                .lerp(state.endPosition, t);

            root.quaternion
                .copy(state.startQuaternion)
                .slerp(state.endQuaternion, t);

            root.scale
                .copy(state.startScale)
                .lerp(state.endScale, t);
        });
    }

    function connect() {
        const source = new EventSource(`${host}/vehiclesLive`);

        source.onmessage = event => {
            try {
                const data = JSON.parse(event.data);
                updateLiveStates(Array.isArray(data) ? data : []);
            } catch (error) {
                console.error("[CreateVehicles] invalid SSE update", error);
            }
        };

        source.onerror = error => {
            console.error("[CreateVehicles] SSE error", error);
        };

        return source;
    }

    let lastWorldSignature = currentMapIdentities().join("|");
    let lastDiagnostic = "";

    setInterval(() => {
        const signature = currentMapIdentities().join("|");

        if (signature !== lastWorldSignature) {
            lastWorldSignature = signature;
            syncRenderables();
            refreshMaterialsForCurrentMap();
        }

        liveStates.forEach(state => ensureModelLoad(state.data));

        const matched = [...liveStates.values()].filter(state =>
            dimensionMatchesCurrentMap(state.data.dimension)
        ).length;

        const loaded = [...liveStates.values()].filter(state =>
            state.data.loaded
        ).length;

        const prbmModels = [...modelCache.values()].filter(model =>
            model?.kind === "prbm"
        ).length;

        const diagnostic =
            `${signature}:${liveStates.size}:${matched}:${loaded}:${objects.size}:${prbmModels}`;

        if (diagnostic !== lastDiagnostic) {
            lastDiagnostic = diagnostic;
            console.log(
                "[CreateVehicles] map identities:",
                currentMapIdentities(),
                "dimension:",
                inferredDimensionForCurrentMap(),
                "live:",
                liveStates.size,
                "matched:",
                matched,
                "loaded:",
                loaded,
                "rendered:",
                objects.size,
                "PRBM models:",
                prbmModels
            );
        }
    }, 500);

    window.CreateVehicleOverlay = {
        scene,
        toggle,
        animate,
        syncRenderables,
    };

    connect();
    console.log("[CreateVehicles] Sable vehicle overlay started (PRBM textured rendering)");
})();
