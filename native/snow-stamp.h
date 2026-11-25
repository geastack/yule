#pragma once

#include "gea_runtime.h"

namespace yule {

template <typename T>
inline T* writable(const gea::TypedArray<T>& view) {
  // Gea passes the view as const. The caller owns the writable buffer.
  return const_cast<T*>(view.data());
}

inline void stamp(std::uint16_t* frame, std::uint16_t* settled, const std::uint8_t* rows,
                  std::uint32_t* dirty, int size, int row, int stride, std::uint16_t pixel) {
  for (int y = 0; y < size; ++y, row += stride) {
    const auto span = rows[y];
    const int first = row + (span >> 4);
    const int count = span & 15;
    if (!count) continue;
    std::fill_n(frame + first, count, pixel);
    if (settled) {
      std::fill_n(settled + first, count, pixel);
    } else {
      const int firstTile = first >> 3;
      const int lastTile = (first + count - 1) >> 3;
      for (int tile = firstTile; tile <= lastTile; ++tile)
        dirty[tile >> 5] |= std::uint32_t{1} << (tile & 31);
    }
  }
}

inline void stampSnowBatch(
    const gea::TypedArray<std::uint16_t>& pixels,
    const gea::TypedArray<std::uint16_t>& settledPixels,
    const gea::TypedArray<std::uint8_t>& spans,
    const gea::TypedArray<std::int32_t>& sizes,
    const gea::TypedArray<std::int32_t>& offsets,
    const gea::TypedArray<std::int32_t>& ids,
    const gea::TypedArray<std::int32_t>& x,
    const gea::TypedArray<std::int32_t>& y,
    const gea::TypedArray<std::uint32_t>& dirtyTiles,
    int count, int width, int height, int colour, bool settles) {
  auto* frame = writable(pixels);
  auto* settled = settles ? writable(settledPixels) : nullptr;
  const auto* rows = spans.data();
  const auto* sizeAt = sizes.data();
  const auto* offsetAt = offsets.data();
  const auto* idAt = ids.data();
  const auto* xAt = x.data();
  const auto* yAt = y.data();
  auto* dirty = writable(dirtyTiles);
  const auto pixel = static_cast<std::uint16_t>(colour);
  for (int i = 0; i < count; ++i) {
    const int id = idAt[i];
    const int size = sizeAt[id];
    const int left = (xAt[i] >> 4) - (size >> 1);
    const int top = (yAt[i] >> 4) - (size >> 1);
    if (left < 0 || top < 0 || left + size > width || top + size > height) continue;
    const int phase = (((yAt[i] >> 2) & 3) << 2) + ((xAt[i] >> 2) & 3);
    stamp(frame, settled, rows + offsetAt[id] + phase * size, dirty, size, top * width + left, width, pixel);
  }
}

inline void restoreSnowTiles(
    const gea::TypedArray<std::uint16_t>& pixels,
    const gea::TypedArray<std::uint16_t>& backdrop,
    const gea::TypedArray<std::uint32_t>& tiles) {
  auto* frame = writable(pixels);
  const auto* source = backdrop.data();
  auto* dirty = writable(tiles);
  const auto pixelsCount = pixels.size();
  for (std::size_t word = 0; word < tiles.size(); ++word) {
    auto mask = dirty[word];
    if (!mask) continue;
    dirty[word] = 0;
    if (mask == UINT32_MAX && word * 256 + 256 <= pixelsCount) {
      std::memcpy(frame + word * 256, source + word * 256, 512);
      continue;
    }
    while (mask) {
      const auto bit = static_cast<unsigned>(__builtin_ctz(mask));
      const auto start = word * 256 + bit * 8;
      const auto count = std::min<std::size_t>(8, pixelsCount - start);
      std::memcpy(frame + start, source + start, count * sizeof(*frame));
      mask &= mask - 1;
    }
  }
}

inline void restoreMarks(const gea::TypedArray<std::uint16_t>& pixels,
                         const gea::TypedArray<std::uint16_t>& backdrop,
                         const gea::TypedArray<std::int32_t>& marks, int count, int stride) {
  auto* frame = writable(pixels);
  const auto* source = backdrop.data();
  const auto* mark = marks.data();
  for (int i = 0; i < count; ++i, mark += 3) {
    int row = mark[0];
    for (int y = 0; y < mark[2]; ++y, row += stride)
      std::memcpy(frame + row, source + row, mark[1] * sizeof(*frame));
  }
}

inline void glowSprite(const gea::TypedArray<std::uint16_t>& pixels,
                        const gea::TypedArray<std::uint8_t>& coverage,
                        int at, int start, int size, int stride,
                        int r, int g, int b, int strength) {
  auto* row = writable(pixels) + start;
  const auto* lightAt = coverage.data() + at;
  for (int y = 0; y < size; ++y, row += stride, lightAt += size) {
    for (int x = 0; x < size; ++x) {
      const int light = (lightAt[x] * strength) >> 8;
      if (!light) continue;
      const auto old = row[x];
      const int red = std::min(31, (old >> 11) + ((r * light) >> 11));
      const int green = std::min(63, ((old >> 5) & 63) + ((g * light) >> 10));
      const int blue = std::min(31, (old & 31) + ((b * light) >> 11));
      row[x] = static_cast<std::uint16_t>((red << 11) | (green << 5) | blue);
    }
  }
}

inline void blendSprite(const gea::TypedArray<std::uint16_t>& pixels,
                         const gea::TypedArray<std::uint8_t>& coverage,
                         int at, int start, int size, int stride,
                         std::uint32_t colour, int strength) {
  constexpr std::uint32_t spread = 0x07e0f81f;
  auto* row = writable(pixels) + start;
  const auto* alphaAt = coverage.data() + at;
  for (int y = 0; y < size; ++y, row += stride, alphaAt += size) {
    for (int x = 0; x < size; ++x) {
      const int alpha = (alphaAt[x] * strength) >> 11;
      if (!alpha) continue;
      const std::uint32_t old = row[x];
      const auto under = (old | (old << 16)) & spread;
      const auto mixed = ((under * (32 - alpha) + colour * alpha) >> 5) & spread;
      row[x] = static_cast<std::uint16_t>(mixed | (mixed >> 16));
    }
  }
}

}  // namespace yule
