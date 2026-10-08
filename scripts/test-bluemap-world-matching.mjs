import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const trainJs = readFileSync(new URL("../bluemap/train.js", import.meta.url), "utf8");
const trainLabelsJs = readFileSync(new URL("../bluemap/train-labels.js", import.meta.url), "utf8");

function section(source, first, last) {
    const start = source.indexOf(first);
    const end = source.indexOf(last, start + first.length);
    assert.ok(start >= 0 && end > start, `could not extract ${first}`);
    return source.slice(start, end);
}

const trainDimensionCode = section(trainJs, "function currentMapIdentities()", "function detectNetworks()");
const labelDimensionCode = section(trainLabelsJs, "function currentWorldKey()", "function cubicBezier(");

const nodes = [
    { id: 10, dimensionLocationData: { dimension: "minecraft:overworld" } },
    { id: 11, dimensionLocationData: { dimension: "minecraft:overworld" } },
    { id: 12, dimensionLocationData: { dimension: "minecraft:the_nether" } },
    { id: 13, dimensionLocationData: { dimension: "minecraft:the_end" } },
    { id: 14, dimensionLocationData: { dimension: "mymod:moon" } },
];

function verify(map, overrides, expectedDimension, expectedIds) {
    const globals = {
        mapViewer: { map: { data: map } },
        networkData: { nodes },
        window: { CREATE_MAP_DIMENSION_OVERRIDES: overrides },
    };

    const train = runInNewContext(
        `${trainDimensionCode}
        ({
            dimension: currentWorldKey(),
            nodeIds: Array.from(nodeMapForDimension(currentWorldKey()).keys()),
            matched: nodes.map(node => dimensionMatchesCurrentMap(node.dimensionLocationData.dimension)),
        })`,
        globals
    );
    assert.equal(train.dimension, expectedDimension);
    assert.deepEqual(Array.from(train.nodeIds), expectedIds);

    const labels = runInNewContext(
        `${labelDimensionCode}
        ({
            dimension: currentWorldKey(),
            nodeIds: Array.from(nodeMapForDimension(currentWorldKey()).keys()),
        })`,
        {
            mapViewer: globals.mapViewer,
            window: globals.window,
            Map,
        }
    );
    assert.equal(labels.dimension, expectedDimension);
    assert.deepEqual(Array.from(labels.nodeIds), expectedIds);
}

verify({ name: "NNSR Craft" }, {}, "minecraft:overworld", [10, 11]);
verify({ name: "NNSR Craft (overworld)" }, {}, "minecraft:overworld", [10, 11]);
verify({ name: "NNSR Nether" }, {}, "minecraft:the_nether", [12]);
verify({ name: "NNSR End" }, {}, "minecraft:the_end", [13]);
verify({ id: "Moon", name: "Lunar Map" }, { moon: "mymod:moon" }, "mymod:moon", [14]);
verify({ id: "main", name: "NNSR Craft" }, { main: "minecraft:the_nether" }, "minecraft:the_nether", [12]);

console.log("BlueMap train and train-label dimension regression tests passed (6 map cases)");
