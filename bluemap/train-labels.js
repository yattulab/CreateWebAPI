/*
 * Optional live train-name markers for BlueMap 5.7.
 *
 * Adds a top-level MarkerSet named "Create 列車名". Each visible Create train
 * gets an HtmlMarker that follows its leading carriage point. BlueMap's marker
 * menu therefore shows the train name and current coordinates, and clicking an
 * individual entry moves the map to that train.
 */

(() => {
    if (window.__createTrainLabelsInstalled) return;
    window.__createTrainLabelsInstalled = true;

    const host = (window.CREATE_TRAIN_WEB_API_URL ?? "http://localhost:8080")
        .replace(/\/+$/, "");

    const MARKER_SET_ID = "create-train-labels";
    const LABEL_OFFSET_Y = 3.0;
    const UPDATE_DURATION_MS = 200;

    const mapViewer = window.bluemap?.mapViewer;
    const BlueMap = window.BlueMap;

    if (!mapViewer || !BlueMap?.MarkerSet || !BlueMap?.HtmlMarker) {
        console.error("[CreateTrainLabels] BlueMap MarkerSet/HtmlMarker API is unavailable");
        return;
    }

    const rootMarkerSet = mapViewer.markers;

    // BlueMap 5.7's NormalMarkerManager periodically removes runtime MarkerSets
    // that are not present in markers.json. Patch the root MarkerSet once so any
    // runtime ids registered here survive those refreshes, regardless of how the
    // marker manager itself is recreated on map changes.
    if (!rootMarkerSet.__createTrainRuntimeMarkerSets) {
        const originalUpdateMarkerSetsFromData =
            rootMarkerSet.updateMarkerSetsFromData.bind(rootMarkerSet);

        Object.defineProperty(rootMarkerSet, "__createTrainRuntimeMarkerSets", {
            configurable: false,
            enumerable: false,
            writable: false,
            value: new Set(),
        });

        rootMarkerSet.updateMarkerSetsFromData = function (data = {}, ignore = []) {
            const preserved = new Set(ignore ?? []);
            this.__createTrainRuntimeMarkerSets.forEach(id => preserved.add(id));
            return originalUpdateMarkerSetsFromData(data, [...preserved]);
        };
    }
    rootMarkerSet.__createTrainRuntimeMarkerSets.add(MARKER_SET_ID);

    function ensureLabelMarkerSet() {
        let markerSet = rootMarkerSet.markerSets.get(MARKER_SET_ID);
        if (markerSet) {
            markerSet.data.label = "Create 列車名";
            markerSet.data.toggleable = true;
            markerSet.data.sorting = 102;
            return markerSet;
        }

        markerSet = new BlueMap.MarkerSet(MARKER_SET_ID, {
            label: "Create 列車名",
            toggleable: true,
            defaultHidden: false,
            sorting: 102,
            markerSets: {},
            markers: {},
        });
        rootMarkerSet.add(markerSet);
        return markerSet;
    }

    let labelMarkerSet = ensureLabelMarkerSet();

    function installStyles() {
        if (document.getElementById("create-train-label-styles")) return;

        const style = document.createElement("style");
        style.id = "create-train-label-styles";
        style.textContent = `
#map-container .bm-marker-html.create-train-name-marker {
    position: relative;
    pointer-events: none;
    user-select: none;
}

#map-container .bm-marker-html.create-train-name-marker .create-train-name-label {
    position: absolute;
    top: 0;
    left: 0;
    transform: translate(-50%, -100%) translate(0, -0.5em);
    white-space: nowrap;
    max-width: 20em;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0.25em 0.45em;
    border-radius: 0.2em;
    background-color: #000a;
    color: #fff;
    filter: drop-shadow(1px 1px 3px #0008);
    font-size: 0.9em;
    line-height: 1.2em;
}

#map-container .bm-marker-html.create-train-name-marker .create-train-name-label::after {
    position: absolute;
    left: 50%;
    bottom: -0.4em;
    transform: translateX(-50%);
    content: "";
    border: solid 0.2em transparent;
    border-top-color: #000a;
}
`;
        document.head.appendChild(style);
    }
    installStyles();

    function escapeHtml(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function displayTrainName(train) {
        let name = train?.name;

        if (name && typeof name === "object") {
            name = name.text ?? name.literal ?? name.name ?? null;
        }

        name = name == null || name === "" ? String(train?.id ?? "Train") : String(name);

        // Create's Component#toString commonly produces names such as
        // literal{Express}. Keep only the text users actually named the train.
        const literal = /^literal\{([\s\S]*)\}$/.exec(name);
        return literal ? literal[1] : name;
    }

    function currentWorldKey() {
        // Reuse the dimension inference from train.js. Custom BlueMap display
        // names like "NNSR Craft" are not Minecraft dimension identifiers.
        if (typeof window.CreateTrainDimension === "function") {
            return window.CreateTrainDimension();
        }

        const name = String(mapViewer.map?.data?.name ?? "").toLocaleLowerCase();
        if (name.includes("nether")) return "minecraft:the_nether";
        if (name.includes("the_end") || name.includes("the end") || name === "end") {
            return "minecraft:the_end";
        }
        return "minecraft:overworld";
    }

    let networkData = null;
    let trainsData = [];
    let animationStates = new Map();
    let networkFetchInFlight = false;

    function nodeMapForDimension(dimKey) {
        if (!networkData || !dimKey) return new Map();

        const nodes = Array.from(networkData.nodes ?? []).filter(node => {
            const dimension = node.dimensionLocationData?.dimension;
            if (!dimension) return false;
            if (typeof window.CreateTrainDimensionMatch === "function") {
                return window.CreateTrainDimensionMatch(dimension);
            }
            const normalized = String(dimension).toLocaleLowerCase();
            return normalized.includes(dimKey) || dimKey.includes(normalized);
        });
        return new Map(nodes.map(node => [node.id, node]));
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
        let previous = bezier.p0;

        for (let i = 1; i <= steps; i++) {
            const point = cubicBezier(
                bezier.p0,
                bezier.p1,
                bezier.p2,
                bezier.p3,
                i / steps
            );
            length += Math.hypot(
                point.x - previous.x,
                point.y - previous.y,
                point.z - previous.z
            );
            previous = point;
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
            const length = approximateBezierLength(bezier) || 1;
            const t = Math.max(0, Math.min(1, (distance ?? 0) / length));
            const reversed = nodeA.id === edge.node2 && nodeB.id === edge.node1;

            return reversed
                ? cubicBezier(bezier.p3, bezier.p2, bezier.p1, bezier.p0, t)
                : cubicBezier(bezier.p0, bezier.p1, bezier.p2, bezier.p3, t);
        }

        const a = nodeA.dimensionLocationData.location;
        const b = nodeB.dimensionLocationData.location;
        const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
        const t = Math.max(0, Math.min(1, (distance ?? 0) / length));

        return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            z: a.z + (b.z - a.z) * t,
        };
    }

    function leadingTrainPosition(train, nodes) {
        for (const car of train?.cars ?? []) {
            const nodeA = nodes.get(car.node1);
            const nodeB = nodes.get(car.node2);
            if (!nodeA || !nodeB) continue;

            return pointOnEdge(
                nodeA,
                nodeB,
                car.positionOnTrack,
                edgeBetween(nodeA, nodeB)
            );
        }

        return null;
    }

    function interpolatePosition(state, now) {
        if (!state) return null;

        const duration = Math.max(1, state.endTime - state.startTime);
        const t = Math.max(0, Math.min(1, (now - state.startTime) / duration));

        return {
            x: state.start.x + (state.end.x - state.start.x) * t,
            y: state.start.y + (state.end.y - state.start.y) * t,
            z: state.start.z + (state.end.z - state.start.z) * t,
        };
    }

    function markerIdForTrain(trainId) {
        return `create-train-label-${encodeURIComponent(String(trainId))}`;
    }

    function ensureTrainMarker(train, markerId, position, sorting) {
        labelMarkerSet = ensureLabelMarkerSet();

        let marker = labelMarkerSet.markers.get(markerId);
        if (!marker || !marker.isHtmlMarker) {
            if (marker) labelMarkerSet.remove(marker);
            marker = new BlueMap.HtmlMarker(markerId);
            labelMarkerSet.add(marker);
        }

        const name = displayTrainName(train);
        marker.updateFromData({
            position: {
                x: position.x,
                y: position.y + LABEL_OFFSET_Y,
                z: position.z,
            },
            label: name,
            sorting,
            listed: true,
            anchor: { x: 0, y: 0 },
            html: `<div class="create-train-name-label">${escapeHtml(name)}</div>`,
            classes: ["create-train-name-marker"],
            minDistance: 0,
            maxDistance: Number.MAX_VALUE,
        });
        marker.visible = true;

        return marker;
    }

    function updateTrainTargets() {
        if (!networkData) return;

        labelMarkerSet = ensureLabelMarkerSet();

        const now = performance.now();
        const nodes = nodeMapForDimension(currentWorldKey());
        const wantedMarkers = new Set();
        const wantedTrains = new Set();

        trainsData.forEach((train, sorting) => {
            const end = leadingTrainPosition(train, nodes);
            if (!end) return;

            const trainId = String(train.id);
            const markerId = markerIdForTrain(trainId);
            const previous = animationStates.get(trainId);
            const start = interpolatePosition(previous, now) ?? end;

            animationStates.set(trainId, {
                markerId,
                start,
                end,
                startTime: now,
                endTime: now + UPDATE_DURATION_MS,
            });

            ensureTrainMarker(train, markerId, start, sorting);
            wantedMarkers.add(markerId);
            wantedTrains.add(trainId);
        });

        [...labelMarkerSet.markers.entries()].forEach(([markerId, marker]) => {
            if (wantedMarkers.has(markerId)) return;
            labelMarkerSet.remove(marker);
        });

        [...animationStates.keys()].forEach(trainId => {
            if (!wantedTrains.has(trainId)) animationStates.delete(trainId);
        });
    }

    async function fetchNetwork() {
        if (networkFetchInFlight) return;
        networkFetchInFlight = true;
        try {
            const response = await fetch(`${host}/network`, { cache: "no-store" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const received = await response.json();
            if (!Array.isArray(received?.nodes)) {
                throw new Error("Invalid railway network response");
            }
            networkData = received;
            updateTrainTargets();
            console.info("[CreateTrainLabels] network loaded:",
                networkData.nodes.length, "nodes,",
                nodeMapForDimension(currentWorldKey()).size, "in", currentWorldKey());
        } catch (error) {
            console.warn("[CreateTrainLabels] network fetch failed; will retry", error);
        } finally {
            networkFetchInFlight = false;
        }
    }

    function connectTrainStream() {
        const source = new EventSource(`${host}/trainsLive`);

        source.onmessage = event => {
            try {
                trainsData = JSON.parse(event.data);
                updateTrainTargets();
            } catch (error) {
                console.error("[CreateTrainLabels] invalid train update", error);
            }
        };

        source.onerror = event => {
            console.error("[CreateTrainLabels] SSE error", event);
        };

        return source;
    }

    function animationLoop() {
        if (labelMarkerSet?.visible) {
            const now = performance.now();

            animationStates.forEach(state => {
                const marker = labelMarkerSet.markers.get(state.markerId);
                if (!marker) return;

                const position = interpolatePosition(state, now);
                if (!position) return;

                marker.position.set(
                    position.x,
                    position.y + LABEL_OFFSET_Y,
                    position.z
                );
            });

            mapViewer.redraw?.();
        }

        requestAnimationFrame(animationLoop);
    }

    let lastWorld = currentWorldKey();
    window.bluemap?.events?.addEventListener?.("bluemapMapChanged", () => {
        lastWorld = currentWorldKey();
        updateTrainTargets();
    });

    // Fallback for custom BlueMap setups where the map-changed event is not
    // forwarded to external scripts.
    setInterval(() => {
        const world = currentWorldKey();
        if (!world || world === lastWorld) return;
        lastWorld = world;
        updateTrainTargets();
    }, 500);

    // A failed startup request previously made all train-name labels stay
    // invisible until a manual refresh. Retry only while missing node data.
    setInterval(() => {
        if (!networkData || (trainsData.length > 0 &&
                nodeMapForDimension(currentWorldKey()).size === 0)) {
            fetchNetwork();
        }
    }, 10000);

    window.CreateTrainLabelDiagnostics = () => ({
        dimension: currentWorldKey(),
        networkNodes: networkData?.nodes?.length ?? null,
        dimensionNodes: nodeMapForDimension(currentWorldKey()).size,
        trainCount: trainsData.length,
        renderedLabels: labelMarkerSet?.markers?.size ?? 0,
        labelSetVisible: labelMarkerSet?.visible ?? false,
    });

    fetchNetwork();
    connectTrainStream();
    animationLoop();

    console.log("[CreateTrainLabels] live train-name markers started");
})();
