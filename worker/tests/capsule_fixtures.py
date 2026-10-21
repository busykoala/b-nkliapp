"""Write the actual historical bearing layout when testing old capsule schemas."""
import zlib
import numpy as np
from benchly.panorama.binary import LEGACY_BUILDING_SAMPLE_DTYPE


def legacy_building_body(header, compressed_body):
    payload = zlib.decompress(compressed_body)
    blocks = []
    offset = 0
    for name, descriptor in sorted(header["arrays"].items(), key=lambda item: item[1]["offset"]):
        block = payload[descriptor["offset"]:descriptor["offset"] + descriptor["bytes"]]
        if name == "building_samples":
            dtype = np.dtype([tuple(field) for field in descriptor["dtype"]])
            block = np.frombuffer(block, dtype=dtype).astype(LEGACY_BUILDING_SAMPLE_DTYPE).tobytes()
            descriptor["dtype"] = LEGACY_BUILDING_SAMPLE_DTYPE.descr
        descriptor["offset"], descriptor["bytes"] = offset, len(block)
        offset += len(block)
        blocks.append(block)
    return zlib.compress(b"".join(blocks))
