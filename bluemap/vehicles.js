/*
 * Live Sable physics vehicle overlay for BlueMap 5.7.
 *
 * Physics Assembler vehicles (Create Aeronautics aircraft, ships, cars, etc.)
 * live inside Sable SubLevels rather than ordinary Create Contraption entities.
 *
 * Consumes:
 *   - /vehiclesLive
 *   - /vehicleModels/<modelId>
 */
(() => {
    if (window.__createVehicleOverlayInstalled) return;
    window.__createVehicleOverlayInstalled = true;

    const host = (window.CREATE_TRAIN_WEB_API_URL ?? "http://localhost:8080")
        .replace(/\/+$/, "");

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

    async function loadModel(modelId) {
        if (modelCache.has(modelId)) return modelCache.get(modelId);
        if (modelRequests.has(modelId)) return modelRequests.get(modelId);

        const request = (async () => {
            try {
                const response = await fetch(
                    `${host}/vehicleModels/${encodeURIComponent(modelId)}`
                );
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const model = await response.json();
                modelCache.set(modelId, model);
                return model;
            } catch (error) {
                console.error(
                    `[CreateVehicles] failed to load model ${modelId}`,
                    error
                );
                modelCache.set(modelId, null);
                return null;
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

    function createRenderable(data) {
        const root = new THREE.Group();
        root.userData.modelId = data.modelId;

        const model = modelCache.get(data.modelId);
        root.add(model ? buildVoxelModel(model) : buildFallbackModel());

        scene.add(root);
        return root;
    }

    function replaceRenderableModel(root, modelId) {
        const model = modelCache.get(modelId);

        let replacement;
        try {
            replacement = model ? buildVoxelModel(model) : buildFallbackModel();
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

            if (!modelCache.has(item.modelId) && !modelRequests.has(item.modelId)) {
                loadModel(item.modelId).then(() => {
                    const root = objects.get(item.id);
                    if (root && root.userData.modelId === item.modelId) {
                        replaceRenderableModel(root, item.modelId);
                    }
                });
            }
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
        }

        const matched = [...liveStates.values()].filter(state =>
            dimensionMatchesCurrentMap(state.data.dimension)
        ).length;

        const loaded = [...liveStates.values()].filter(state =>
            state.data.loaded
        ).length;

        const diagnostic =
            `${signature}:${liveStates.size}:${matched}:${loaded}:${objects.size}`;

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
                objects.size
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
    console.log("[CreateVehicles] Sable vehicle overlay started");
})();
