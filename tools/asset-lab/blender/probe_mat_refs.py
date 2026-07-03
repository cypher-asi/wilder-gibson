"""One-off probe: dump every material's embedded texture-node filepaths
from an FBX (before any rescue/rewiring), plus base color factors.

Usage:
  blender -b --factory-startup -P probe_mat_refs.py -- --fbx <file.fbx>
"""

import argparse
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument("--fbx", required=True)
args = parser.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=args.fbx)

for mat in bpy.data.materials:
    print(f"MATERIAL {mat.name}")
    if not mat.use_nodes:
        print("  (no nodes)")
        continue
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        bc = bsdf.inputs["Base Color"].default_value
        print(
            f"  base_color=({bc[0]:.3f},{bc[1]:.3f},{bc[2]:.3f}) "
            f"metallic={bsdf.inputs['Metallic'].default_value:.2f} "
            f"roughness={bsdf.inputs['Roughness'].default_value:.2f}"
        )
    for node in mat.node_tree.nodes:
        if node.type == "TEX_IMAGE":
            fp = node.image.filepath if node.image else "(none)"
            print(f"  TEX_IMAGE -> {fp}")

print("PROBE_OK")
