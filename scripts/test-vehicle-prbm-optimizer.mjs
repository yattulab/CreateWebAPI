import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../bluemap/vehicles.js", import.meta.url), "utf8");
const begin = source.indexOf("    function optimizePrbmGeometry(");
const end = source.indexOf("    function buildPrbmModel(", begin);
assert.ok(begin > 0 && end > begin, "Could not find the PRBM optimization function");

class MockBufferAttribute {
    constructor(array, itemSize) {
        this.array = array;
        this.itemSize = itemSize;
    }
}

const THREE = { BufferAttribute: MockBufferAttribute, NormalBlending: 1 };
const optimize = new Function(
    "THREE",
    source.slice(begin, end) + "\nreturn optimizePrbmGeometry;"
)(THREE);

class MockGeometry {
    constructor({ groups, positionCount, indices = null, drawRange = { start: 0, count: Infinity } }) {
        this.groups = groups.map(group => ({ ...group }));
        this.position = { count: positionCount };
        this.index = indices === null ? null : new MockBufferAttribute(indices, 1);
        this.drawRange = drawRange;
        this.changed = false;
    }
    getAttribute(name) {
        return name === "position" ? this.position : undefined;
    }
    getIndex() {
        return this.index;
    }
    setIndex(index) {
        this.changed = true;
        this.index = index;
    }
    clearGroups() {
        this.groups = [];
    }
    addGroup(start, count, materialIndex) {
        this.groups.push({ start, count, materialIndex });
    }
}

function groupedTriangles(geometry) {
    const indices = geometry.index?.array ??
        Uint32Array.from({ length: geometry.position.count }, (_, index) => index);

    return geometry.groups.map(group => ({
        materialIndex: group.materialIndex,
        triangles: Array.from(
            { length: group.count / 3 },
            (_, triangle) => [...indices.slice(
                group.start + triangle * 3,
                group.start + triangle * 3 + 3,
            )]
        ),
    }));
}

function opaqueMaterialCounts(geometry) {
    const counts = new Map();
    for (const group of groupedTriangles(geometry)) {
        const current = counts.get(group.materialIndex) ?? [];
        current.push(...group.triangles.map(t => t.join(",")));
        counts.set(group.materialIndex, current);
    }
    for (const triangles of counts.values()) triangles.sort();
    return [...counts.entries()].sort(([a], [b]) => a - b);
}

const opaque = [{ transparent: false }, { transparent: false }];
const interleavedGroups = [
    { start: 0, count: 3, materialIndex: 0 },
    { start: 3, count: 3, materialIndex: 1 },
    { start: 6, count: 3, materialIndex: 0 },
    { start: 9, count: 3, materialIndex: 1 },
];

for (const indexed of [true, false]) {
    const geometry = new MockGeometry({
        groups: interleavedGroups,
        positionCount: 12,
        indices: indexed ? Uint16Array.from({ length: 12 }, (_, i) => i) : null,
    });
    const before = opaqueMaterialCounts(geometry);
    const info = optimize(geometry, opaque);

    assert.equal(info.optimized, true);
    assert.equal(info.before, 4);
    assert.equal(info.after, 2);
    assert.deepEqual(geometry.groups.map(group => group.materialIndex), [0, 1]);
    assert.deepEqual([...geometry.index.array], [0, 1, 2, 6, 7, 8, 3, 4, 5, 9, 10, 11]);
    assert.deepEqual(opaqueMaterialCounts(geometry), before, "Triangle winding/material must be preserved");
}

// Regroup only opaque triangles. Keep transparent groups unmerged and in
// their original relative order for correct blending.
{
    const materials = [
        { transparent: false },
        { transparent: true },
        { transparent: false },
    ];
    const geometry = new MockGeometry({
        groups: [
            { start: 0, count: 3, materialIndex: 0 },
            { start: 3, count: 3, materialIndex: 1 },
            { start: 6, count: 3, materialIndex: 0 },
            { start: 9, count: 3, materialIndex: 1 },
            { start: 12, count: 3, materialIndex: 2 },
        ],
        positionCount: 15,
        indices: Uint16Array.from({ length: 15 }, (_, i) => i),
    });
    const before = opaqueMaterialCounts(geometry);
    const oldTransparent = groupedTriangles(geometry)
        .filter(group => materials[group.materialIndex].transparent)
        .map(group => group.triangles.flat());

    const info = optimize(geometry, materials);
    assert.equal(info.optimized, true);
    assert.equal(info.transparentGroups, 2);
    assert.equal(info.after, 4);
    assert.deepEqual(geometry.groups.map(g => g.materialIndex), [0, 2, 1, 1]);
    assert.deepEqual(
        groupedTriangles(geometry)
            .filter(group => materials[group.materialIndex].transparent)
            .map(group => group.triangles.flat()),
        oldTransparent
    );
    assert.deepEqual(opaqueMaterialCounts(geometry), before);
}

// Non-opaque materials with depthWrite false must remain protected.
{
    const geometry = new MockGeometry({
        groups: interleavedGroups,
        positionCount: 12,
    });
    const info = optimize(geometry, [
        { transparent: false },
        { transparent: false, depthWrite: false },
    ]);
    assert.equal(info.transparentGroups, 2);
    assert.equal(info.after, 3);
    assert.deepEqual(geometry.groups.map(g => g.materialIndex), [0, 1, 1]);
}

// Malformed geometry or partial drawRanges must remain unmodified.
for (const input of [
    { groups: [{ start: 0, count: 3, materialIndex: 0 },
               { start: 9, count: 3, materialIndex: 0 }], positionCount: 12 },
    { groups: interleavedGroups, positionCount: 12,
      drawRange: { start: 0, count: 6 } },
    { groups: [{ start: 0, count: 3, materialIndex: 0 },
               { start: 3, count: 3, materialIndex: 99 }], positionCount: 6 },
]) {
    const geometry = new MockGeometry(input);
    const previous = structuredClone(geometry.groups);
    const info = optimize(geometry, opaque);
    assert.equal(info.optimized, false);
    assert.equal(geometry.changed, false);
    assert.deepEqual(geometry.groups, previous);
}

// Indices exceeding Uint16 must remain intact after reordering.
{
    const count = 65538;
    const geometry = new MockGeometry({
        groups: [
            { start: 0, count: 65535, materialIndex: 0 },
            { start: 65535, count: 3, materialIndex: 0 },
        ],
        positionCount: count,
    });
    const info = optimize(geometry, opaque);
    assert.equal(info.optimized, true);
    assert.ok(geometry.index.array instanceof Uint32Array);
    assert.equal(geometry.index.array[65537], 65537);
}

assert.match(source, /mesh\.frustumCulled = window\.CREATE_VEHICLE_FRUSTUM_CULLING !== false/);
assert.match(source, /optimizationStats/);
console.log("Sable vehicle PRBM optimizer tests passed: indexed, non-indexed, transparency, fallback, Uint32");
