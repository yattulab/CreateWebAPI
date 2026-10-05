/*
 * Live Create contraption overlay for BlueMap 5.7.
 *
 * Consumes:
 *   - /contraptionsLive
 *   - /contraptionModels/<modelId>
 *
 * Train carriages are intentionally excluded by the server because train.js
 * already renders them using the dedicated railway API and PRBM models.
 */
(() => {
    if (window.__createContraptionOverlayInstalled) return;
    window.__createContraptionOverlayInstalled = true;

    const host = (window.CREATE_TRAIN_WEB_API_URL ?? "http://localhost:8080")
        .replace(/\/+$/, "");

    const mapViewer = window.bluemap?.mapViewer;
    const renderer = mapViewer?.renderer;
    const THREE = window.BlueMap?.Three;

    if (!mapViewer || !renderer || !THREE || !window.BlueMap?.MarkerSet) {
        console.error("[CreateContraptions] BlueMap renderer API is unavailable");
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
        const id = "create-contraptions";
        const existing = mapViewer.markers.markerSets?.get(id);
        if (existing) {
            existing.data.label = "Create カラクリ";
            existing.data.toggleable = true;
            existing.data.sorting = 102;
            return existing;
        }

        const markerSet = new window.BlueMap.MarkerSet(id, {
            label: "Create カラクリ",
            toggleable: true,
            defaultHidden: false,
            sorting: 102,
            markerSets: {},
            markers: {},
        });
        mapViewer.markers.add(markerSet);
        return markerSet;
    }

    const toggle = createToggleMarkerSet();
    mapViewer.markers.__createTrainRuntimeMarkerSets?.add?.("create-contraptions");

    function currentWorldKey() {
        const mapName = mapViewer.map?.data?.name;
        if (!mapName) return "";
        const match = /\((?<name>.*)\)/.exec(mapName);
        return (match?.groups?.name ?? mapName).toLocaleLowerCase();
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
                    `${host}/contraptionModels/${encodeURIComponent(modelId)}`
                );
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const model = await response.json();
                modelCache.set(modelId, model);
                return model;
            } catch (error) {
                console.error(
                    `[CreateContraptions] failed to load model ${modelId}`,
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
        group.position.set(-0.5, -0.5, -0.5);

        const byBlock = new Map();
        for (const block of model.blocks ?? []) {
            if (!byBlock.has(block.block)) byBlock.set(block.block, []);
            byBlock.get(block.block).push(block);
        }

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

    function buildFallbackModel() {
        const group = new THREE.Group();
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(2, 2, 2),
            new THREE.MeshBasicMaterial({
                color: 0xff8c00,
                wireframe: true,
            })
        );
        group.add(mesh);
        group.userData.createContraptionFallback = true;
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
        while (root.children.length) {
            root.remove(root.children[0]);
        }
        const model = modelCache.get(modelId);
        root.add(model ? buildVoxelModel(model) : buildFallbackModel());
        root.userData.modelId = modelId;
    }

    function quaternionFromBasis(data) {
        const x = new THREE.Vector3(data.basisX?.x ?? 1, data.basisX?.y ?? 0, data.basisX?.z ?? 0);
        const y = new THREE.Vector3(data.basisY?.x ?? 0, data.basisY?.y ?? 1, data.basisY?.z ?? 0);
        const z = new THREE.Vector3(data.basisZ?.x ?? 0, data.basisZ?.y ?? 0, data.basisZ?.z ?? 1);

        if (x.lengthSq() < 1e-10 || y.lengthSq() < 1e-10 || z.lengthSq() < 1e-10) {
            return new THREE.Quaternion();
        }

        x.normalize();
        y.normalize();
        z.normalize();

        const matrix = new THREE.Matrix4().makeBasis(x, y, z);
        return new THREE.Quaternion().setFromRotationMatrix(matrix);
    }

    function updateLiveStates(data) {
        const now = performance.now();
        const seen = new Set();

        for (const item of data) {
            seen.add(item.id);
            const endPosition = new THREE.Vector3(item.x, item.y, item.z);
            const endQuaternion = quaternionFromBasis(item);
            const previous = liveStates.get(item.id);

            const startPosition = previous
                ? previous.endPosition.clone()
                : endPosition.clone();
            const startQuaternion = previous
                ? previous.endQuaternion.clone()
                : endQuaternion.clone();

            liveStates.set(item.id, {
                data: item,
                startPosition,
                endPosition,
                startQuaternion,
                endQuaternion,
                startTime: now,
                endTime: previous ? now + 200 : now,
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

        for (const id of Array.from(liveStates.keys())) {
            if (!seen.has(id)) liveStates.delete(id);
        }

        syncRenderables();
    }

    function syncRenderables() {
        const dimension = currentWorldKey();
        const wanted = new Set();

        liveStates.forEach((state, id) => {
            const item = state.data;
            if (!item.dimension?.toLocaleLowerCase().includes(dimension)) return;

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
        const dimension = currentWorldKey();

        liveStates.forEach((state, id) => {
            if (!state.data.dimension?.toLocaleLowerCase().includes(dimension)) return;
            const root = objects.get(id);
            if (!root) return;

            const duration = Math.max(1, state.endTime - state.startTime);
            const t = Math.max(0, Math.min(1, (now - state.startTime) / duration));

            root.position
                .copy(state.startPosition)
                .lerp(state.endPosition, t)
                .addScalar(0.5);

            root.quaternion
                .copy(state.startQuaternion)
                .slerp(state.endQuaternion, t);
        });
    }

    function connect() {
        const source = new EventSource(`${host}/contraptionsLive`);

        source.onmessage = event => {
            try {
                const data = JSON.parse(event.data);
                updateLiveStates(Array.isArray(data) ? data : []);
            } catch (error) {
                console.error("[CreateContraptions] invalid SSE update", error);
            }
        };

        source.onerror = error => {
            console.error("[CreateContraptions] SSE error", error);
        };

        return source;
    }

    let lastWorld = currentWorldKey();
    setInterval(() => {
        const world = currentWorldKey();
        if (world === lastWorld) return;
        lastWorld = world;
        syncRenderables();
    }, 500);

    window.CreateContraptionOverlay = {
        scene,
        toggle,
        animate,
        syncRenderables,
    };

    connect();
    console.log("[CreateContraptions] live overlay started");
})();
