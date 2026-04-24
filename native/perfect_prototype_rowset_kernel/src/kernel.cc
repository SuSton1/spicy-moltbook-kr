#include <node_api.h>

#include <algorithm>
#include <cerrno>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <string>
#include <unistd.h>
#include <vector>

#if !defined(__x86_64__) && !defined(_M_X64)
#error "Perfect prototype native rowset kernel requires x86_64"
#endif
#if !defined(__AVX2__)
#error "Perfect prototype native rowset kernel requires AVX2"
#endif
#if !defined(__POPCNT__)
#error "Perfect prototype native rowset kernel requires POPCNT"
#endif

#include <immintrin.h>

namespace {

struct Uint32View {
  const uint32_t* data = nullptr;
  size_t length = 0;
};

struct MutableUint32View {
  uint32_t* data = nullptr;
  size_t length = 0;
};

struct Int32View {
  const int32_t* data = nullptr;
  size_t length = 0;
};

struct BigUint64View {
  const uint64_t* data = nullptr;
  size_t length = 0;
};

constexpr const char* kPerfectProtoSparseKernelMode = "adaptive_exact_v4";

uint64_t gSparseEqualSizeMergeCount = 0U;
uint64_t gSparseAdaptiveGallopCount = 0U;
uint64_t gSparseCountFastPathCount = 0U;
uint64_t gSparseBitmapWordRunCount = 0U;
uint64_t gSparseBitmapSkippedRunCount = 0U;
uint64_t gSparseBitmapPartialRunCount = 0U;
uint64_t gSparseBitmapFullRunHitCount = 0U;

inline napi_value ThrowError(napi_env env, const char* message) {
  napi_throw_error(env, nullptr, message);
  return nullptr;
}

inline napi_value ThrowTypeError(napi_env env, const char* message) {
  napi_throw_type_error(env, nullptr, message);
  return nullptr;
}

inline size_t RequiredBitmapWordCount(uint32_t universe_size) {
  return (static_cast<size_t>(universe_size) + 31U) / 32U;
}

inline uint32_t BitmapLastWordMask(uint32_t universe_size) {
  if (universe_size < 1U) return 0U;
  const uint32_t trailing_bits = universe_size & 31U;
  if (trailing_bits == 0U) return 0xffffffffU;
  return (1U << trailing_bits) - 1U;
}

inline bool ValidateBitmapMaskForUniverse(uint32_t universe_size, uint32_t word_index, uint32_t* mask) {
  const size_t required_words = RequiredBitmapWordCount(universe_size);
  if (required_words < 1U) return false;
  if (static_cast<size_t>(word_index) >= required_words) return false;
  if (static_cast<size_t>(word_index) + 1U == required_words) {
    const uint32_t allowed_mask = BitmapLastWordMask(universe_size);
    if (((*mask) & (~allowed_mask)) != 0U) return false;
    *mask &= allowed_mask;
  }
  return true;
}

inline bool ValidateBitmapWordsAgainstUniverse(const uint32_t* words, size_t length, uint32_t universe_size) {
  const size_t required_words = RequiredBitmapWordCount(universe_size);
  if (required_words < 1U) return length == 0U;
  if (length < required_words) return false;
  for (size_t word_index = required_words; word_index < length; word_index += 1U) {
    if (words[word_index] != 0U) return false;
  }
  const uint32_t allowed_mask = BitmapLastWordMask(universe_size);
  if ((words[required_words - 1U] & (~allowed_mask)) != 0U) {
    return false;
  }
  return true;
}

inline bool GetCallbackArgs(napi_env env, napi_callback_info info, size_t expected, size_t* argc_out, napi_value** argv_out) {
  *argc_out = expected;
  *argv_out = new napi_value[expected];
  napi_status status = napi_get_cb_info(env, info, argc_out, *argv_out, nullptr, nullptr);
  if (status != napi_ok) {
    delete[] *argv_out;
    *argv_out = nullptr;
    ThrowError(env, "Failed to read native rowset kernel arguments");
    return false;
  }
  return true;
}

inline bool GetUint32ArrayView(napi_env env, napi_value value, const char* label, Uint32View* out) {
  bool is_typed_array = false;
  if (napi_is_typedarray(env, value, &is_typed_array) != napi_ok || !is_typed_array) {
    ThrowTypeError(env, (std::string(label) + " must be a Uint32Array").c_str());
    return false;
  }
  napi_typedarray_type type;
  size_t length = 0;
  void* data = nullptr;
  napi_value arraybuffer;
  size_t byte_offset = 0;
  if (napi_get_typedarray_info(env, value, &type, &length, &data, &arraybuffer, &byte_offset) != napi_ok) {
    ThrowError(env, (std::string("Failed to inspect ") + label).c_str());
    return false;
  }
  if (type != napi_uint32_array) {
    ThrowTypeError(env, (std::string(label) + " must be a Uint32Array").c_str());
    return false;
  }
  out->data = static_cast<const uint32_t*>(data);
  out->length = length;
  return true;
}

inline bool GetMutableUint32ArrayView(napi_env env, napi_value value, const char* label, MutableUint32View* out) {
  bool is_typed_array = false;
  if (napi_is_typedarray(env, value, &is_typed_array) != napi_ok || !is_typed_array) {
    ThrowTypeError(env, (std::string(label) + " must be a Uint32Array").c_str());
    return false;
  }
  napi_typedarray_type type;
  size_t length = 0;
  void* data = nullptr;
  napi_value arraybuffer;
  size_t byte_offset = 0;
  if (napi_get_typedarray_info(env, value, &type, &length, &data, &arraybuffer, &byte_offset) != napi_ok) {
    ThrowError(env, (std::string("Failed to inspect ") + label).c_str());
    return false;
  }
  if (type != napi_uint32_array) {
    ThrowTypeError(env, (std::string(label) + " must be a Uint32Array").c_str());
    return false;
  }
  out->data = static_cast<uint32_t*>(data);
  out->length = length;
  return true;
}

inline bool GetBufferView(napi_env env, napi_value value, const char* label, const uint8_t** data_out, size_t* length_out) {
  bool is_buffer = false;
  if (napi_is_buffer(env, value, &is_buffer) != napi_ok || !is_buffer) {
    ThrowTypeError(env, (std::string(label) + " must be a Buffer").c_str());
    return false;
  }
  void* raw_data = nullptr;
  size_t raw_length = 0;
  if (napi_get_buffer_info(env, value, &raw_data, &raw_length) != napi_ok) {
    ThrowError(env, (std::string("Failed to inspect ") + label).c_str());
    return false;
  }
  *data_out = static_cast<const uint8_t*>(raw_data);
  *length_out = raw_length;
  return true;
}

inline bool GetInt32ArrayView(napi_env env, napi_value value, const char* label, Int32View* out) {
  bool is_typed_array = false;
  if (napi_is_typedarray(env, value, &is_typed_array) != napi_ok || !is_typed_array) {
    ThrowTypeError(env, (std::string(label) + " must be an Int32Array").c_str());
    return false;
  }
  napi_typedarray_type type;
  size_t length = 0;
  void* data = nullptr;
  napi_value arraybuffer;
  size_t byte_offset = 0;
  if (napi_get_typedarray_info(env, value, &type, &length, &data, &arraybuffer, &byte_offset) != napi_ok) {
    ThrowError(env, (std::string("Failed to inspect ") + label).c_str());
    return false;
  }
  if (type != napi_int32_array) {
    ThrowTypeError(env, (std::string(label) + " must be an Int32Array").c_str());
    return false;
  }
  out->data = static_cast<const int32_t*>(data);
  out->length = length;
  return true;
}

inline bool GetBigUint64ArrayView(napi_env env, napi_value value, const char* label, BigUint64View* out) {
  bool is_typed_array = false;
  if (napi_is_typedarray(env, value, &is_typed_array) != napi_ok || !is_typed_array) {
    ThrowTypeError(env, (std::string(label) + " must be a BigUint64Array").c_str());
    return false;
  }
  napi_typedarray_type type;
  size_t length = 0;
  void* data = nullptr;
  napi_value arraybuffer;
  size_t byte_offset = 0;
  if (napi_get_typedarray_info(env, value, &type, &length, &data, &arraybuffer, &byte_offset) != napi_ok) {
    ThrowError(env, (std::string("Failed to inspect ") + label).c_str());
    return false;
  }
  if (type != napi_biguint64_array) {
    ThrowTypeError(env, (std::string(label) + " must be a BigUint64Array").c_str());
    return false;
  }
  out->data = static_cast<const uint64_t*>(data);
  out->length = length;
  return true;
}

inline bool GetArrayLength(napi_env env, napi_value value, const char* label, uint32_t* out) {
  bool is_array = false;
  if (napi_is_array(env, value, &is_array) != napi_ok || !is_array) {
    ThrowTypeError(env, (std::string(label) + " must be an array").c_str());
    return false;
  }
  if (napi_get_array_length(env, value, out) != napi_ok) {
    ThrowError(env, (std::string("Failed to inspect ") + label).c_str());
    return false;
  }
  return true;
}

inline bool GetUint32ArrayViewList(
    napi_env env,
    napi_value value,
    const char* label,
    std::vector<Uint32View>* out) {
  uint32_t length = 0U;
  if (!GetArrayLength(env, value, label, &length)) {
    return false;
  }
  out->clear();
  out->reserve(static_cast<size_t>(length));
  for (uint32_t index = 0U; index < length; index += 1U) {
    napi_value element;
    if (napi_get_element(env, value, index, &element) != napi_ok) {
      ThrowError(
          env,
          (std::string("Failed to read ") + label + "[" + std::to_string(index) + "]").c_str());
      return false;
    }
    Uint32View view;
    const std::string element_label =
        std::string(label) + "[" + std::to_string(index) + "]";
    if (!GetUint32ArrayView(env, element, element_label.c_str(), &view)) {
      return false;
    }
    out->push_back(view);
  }
  return true;
}

inline bool GetRequiredUint32(napi_env env, napi_value value, const char* label, uint32_t* out) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_number) {
    ThrowTypeError(env, (std::string(label) + " must be a number").c_str());
    return false;
  }
  if (napi_get_value_uint32(env, value, out) != napi_ok) {
    ThrowTypeError(env, (std::string(label) + " must be a uint32").c_str());
    return false;
  }
  return true;
}

inline bool GetRequiredInt32(napi_env env, napi_value value, const char* label, int32_t* out) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_number) {
    ThrowTypeError(env, (std::string(label) + " must be a number").c_str());
    return false;
  }
  if (napi_get_value_int32(env, value, out) != napi_ok) {
    ThrowTypeError(env, (std::string(label) + " must be an int32").c_str());
    return false;
  }
  return true;
}

inline bool GetOptionalUint32(napi_env env, napi_value value, uint32_t* out, bool* present) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok) {
    ThrowError(env, "Failed to inspect optional uint32 argument");
    return false;
  }
  if (type == napi_undefined || type == napi_null) {
    *present = false;
    *out = 0;
    return true;
  }
  *present = true;
  return GetRequiredUint32(env, value, "optional uint32", out);
}

inline bool GetRequiredUint64BigInt(napi_env env, napi_value value, const char* label, uint64_t* out) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_bigint) {
    ThrowTypeError(env, (std::string(label) + " must be a bigint").c_str());
    return false;
  }
  bool lossless = false;
  if (napi_get_value_bigint_uint64(env, value, out, &lossless) != napi_ok || !lossless) {
    ThrowTypeError(env, (std::string(label) + " must be a lossless uint64 bigint").c_str());
    return false;
  }
  return true;
}

inline napi_value CreateUint32ArrayCopy(napi_env env, const uint32_t* values, size_t length) {
  void* data = nullptr;
  napi_value arraybuffer;
  size_t byte_length = length * sizeof(uint32_t);
  if (napi_create_arraybuffer(env, byte_length, &data, &arraybuffer) != napi_ok) {
    return ThrowError(env, "Failed to allocate arraybuffer");
  }
  if (byte_length > 0 && values != nullptr) {
    std::memcpy(data, values, byte_length);
  }
  napi_value typed_array;
  if (napi_create_typedarray(env, napi_uint32_array, length, arraybuffer, 0, &typed_array) != napi_ok) {
    return ThrowError(env, "Failed to create Uint32Array");
  }
  return typed_array;
}

inline napi_value CreateUint32Result(napi_env env, uint32_t value) {
  napi_value result;
  if (napi_create_uint32(env, value, &result) != napi_ok) {
    return ThrowError(env, "Failed to create uint32 result");
  }
  return result;
}

inline bool SetNamedUint32(napi_env env, napi_value target, const char* key, uint32_t value) {
  napi_value number;
  if (napi_create_uint32(env, value, &number) != napi_ok) {
    ThrowError(env, "Failed to create uint32 property");
    return false;
  }
  if (napi_set_named_property(env, target, key, number) != napi_ok) {
    ThrowError(env, "Failed to set uint32 property");
    return false;
  }
  return true;
}

inline bool SetNamedDouble(napi_env env, napi_value target, const char* key, double value) {
  napi_value number;
  if (napi_create_double(env, value, &number) != napi_ok) {
    ThrowError(env, "Failed to create double property");
    return false;
  }
  if (napi_set_named_property(env, target, key, number) != napi_ok) {
    ThrowError(env, "Failed to set double property");
    return false;
  }
  return true;
}

inline uint32_t Popcount32(uint32_t value) {
#if defined(__GNUG__) || defined(__clang__)
  return static_cast<uint32_t>(__builtin_popcount(value));
#else
  uint32_t count = 0;
  while (value != 0) {
    value &= value - 1U;
    count += 1U;
  }
  return count;
#endif
}

inline uint32_t Popcount64(uint64_t value) {
#if defined(__GNUG__) || defined(__clang__)
  return static_cast<uint32_t>(__builtin_popcountll(value));
#else
  uint32_t count = 0;
  while (value != 0U) {
    value &= value - 1U;
    count += 1U;
  }
  return count;
#endif
}

inline uint32_t TrailingZeroCount32(uint32_t value) {
#if defined(__GNUG__) || defined(__clang__)
  return static_cast<uint32_t>(__builtin_ctz(value));
#else
  uint32_t index = 0U;
  while (((value >> index) & 1U) == 0U) {
    index += 1U;
  }
  return index;
#endif
}

inline uint32_t TrailingZeroCount64(uint64_t value) {
#if defined(__GNUG__) || defined(__clang__)
  return static_cast<uint32_t>(__builtin_ctzll(value));
#else
  uint32_t index = 0U;
  while (((value >> index) & 1U) == 0U) {
    index += 1U;
  }
  return index;
#endif
}

inline bool BitmapWordsAnyNonZeroAvx2(const uint32_t* words, size_t length) {
  size_t index = 0U;
  for (; index + 8U <= length; index += 8U) {
    const __m256i vector = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(words + index));
    if (_mm256_testz_si256(vector, vector) == 0) {
      return true;
    }
  }
  for (; index < length; index += 1U) {
    if (words[index] != 0U) return true;
  }
  return false;
}

inline uint32_t BitmapBitmapIntersectionCountAvx2(const uint32_t* left_words, const uint32_t* right_words, size_t limit) {
  uint32_t count = 0U;
  size_t index = 0U;
  for (; index + 8U <= limit; index += 8U) {
    const __m256i left = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(left_words + index));
    const __m256i right = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(right_words + index));
    const __m256i intersected = _mm256_and_si256(left, right);
    count += Popcount64(static_cast<uint64_t>(_mm256_extract_epi64(intersected, 0)));
    count += Popcount64(static_cast<uint64_t>(_mm256_extract_epi64(intersected, 1)));
    count += Popcount64(static_cast<uint64_t>(_mm256_extract_epi64(intersected, 2)));
    count += Popcount64(static_cast<uint64_t>(_mm256_extract_epi64(intersected, 3)));
  }
  for (; index < limit; index += 1U) {
    count += Popcount32(left_words[index] & right_words[index]);
  }
  return count;
}

inline uint32_t BitmapBitmapIntersectionWordsFillAvx2(
    const uint32_t* left_words,
    const uint32_t* right_words,
    size_t limit,
    uint32_t* out_words) {
  uint32_t count = 0U;
  size_t index = 0U;
  for (; index + 8U <= limit; index += 8U) {
    const __m256i left = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(left_words + index));
    const __m256i right = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(right_words + index));
    const __m256i intersected = _mm256_and_si256(left, right);
    _mm256_storeu_si256(reinterpret_cast<__m256i*>(out_words + index), intersected);
    count += Popcount64(static_cast<uint64_t>(_mm256_extract_epi64(intersected, 0)));
    count += Popcount64(static_cast<uint64_t>(_mm256_extract_epi64(intersected, 1)));
    count += Popcount64(static_cast<uint64_t>(_mm256_extract_epi64(intersected, 2)));
    count += Popcount64(static_cast<uint64_t>(_mm256_extract_epi64(intersected, 3)));
  }
  for (; index < limit; index += 1U) {
    const uint32_t word = left_words[index] & right_words[index];
    out_words[index] = word;
    count += Popcount32(word);
  }
  return count;
}

inline bool BitmapWordsEqualAvx2(const uint32_t* left_words, size_t left_length, const uint32_t* right_words, size_t right_length) {
  const size_t overlap = std::min(left_length, right_length);
  size_t index = 0U;
  for (; index + 8U <= overlap; index += 8U) {
    const __m256i left = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(left_words + index));
    const __m256i right = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(right_words + index));
    const __m256i diff = _mm256_xor_si256(left, right);
    if (_mm256_testz_si256(diff, diff) == 0) {
      return false;
    }
  }
  for (; index < overlap; index += 1U) {
    if (left_words[index] != right_words[index]) return false;
  }
  if (left_length > overlap) {
    return !BitmapWordsAnyNonZeroAvx2(left_words + overlap, left_length - overlap);
  }
  if (right_length > overlap) {
    return !BitmapWordsAnyNonZeroAvx2(right_words + overlap, right_length - overlap);
  }
  return true;
}

inline bool BitmapWordsSubsetAvx2(const uint32_t* subset_words, size_t subset_length, const uint32_t* superset_words, size_t superset_length) {
  const size_t overlap = std::min(subset_length, superset_length);
  size_t index = 0U;
  for (; index + 8U <= overlap; index += 8U) {
    const __m256i subset = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(subset_words + index));
    const __m256i superset = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(superset_words + index));
    const __m256i diff = _mm256_andnot_si256(superset, subset);
    if (_mm256_testz_si256(diff, diff) == 0) {
      return false;
    }
  }
  for (; index < overlap; index += 1U) {
    if ((subset_words[index] & ~superset_words[index]) != 0U) {
      return false;
    }
  }
  if (subset_length > overlap) {
    return !BitmapWordsAnyNonZeroAvx2(subset_words + overlap, subset_length - overlap);
  }
  return true;
}

inline uint32_t MostSignificantBitIndex32(uint32_t value) {
#if defined(__GNUG__) || defined(__clang__)
  return 31U - static_cast<uint32_t>(__builtin_clz(value));
#else
  uint32_t index = 31U;
  while (((value >> index) & 1U) == 0U) {
    index -= 1U;
  }
  return index;
#endif
}

inline size_t LowerBoundUint32(const uint32_t* data, size_t begin, size_t end, uint32_t target) {
  size_t low = begin;
  size_t high = end;
  while (low < high) {
    const size_t mid = low + ((high - low) >> 1U);
    if (data[mid] < target) {
      low = mid + 1U;
    } else {
      high = mid;
    }
  }
  return low;
}

inline size_t GallopingLowerBoundUint32(const uint32_t* data, size_t begin, size_t end, uint32_t target) {
  if (begin >= end) return begin;
  if (data[begin] >= target) return begin;
  size_t low = begin + 1U;
  size_t step = 1U;
  for (;;) {
    const size_t probe_index = begin + step;
    if (probe_index >= end) {
      return LowerBoundUint32(data, low, end, target);
    }
    if (data[probe_index] >= target) {
      return LowerBoundUint32(data, low, probe_index + 1U, target);
    }
    low = probe_index + 1U;
    step <<= 1U;
  }
}

inline bool ShouldUseSparseAdaptiveSearch(size_t smaller_length, size_t larger_length) {
  return smaller_length > 0U && larger_length >= smaller_length * 8U;
}

inline uint32_t SparseSparseIntersectionCountMerge(
    const uint32_t* left_values,
    size_t left_length,
    const uint32_t* right_values,
    size_t right_length) {
  size_t left_index = 0U;
  size_t right_index = 0U;
  uint32_t count = 0U;
  while (left_index < left_length && right_index < right_length) {
    const uint32_t left_value = left_values[left_index];
    const uint32_t right_value = right_values[right_index];
    const bool left_less = left_value < right_value;
    const bool right_less = right_value < left_value;
    if (!left_less && !right_less) {
      count += 1U;
    }
    left_index += static_cast<size_t>(!right_less);
    right_index += static_cast<size_t>(!left_less);
  }
  return count;
}

template <typename OnMatch>
inline uint32_t SparseSparseIntersectionEmitMerge(
    const uint32_t* left_values,
    size_t left_length,
    const uint32_t* right_values,
    size_t right_length,
    OnMatch on_match) {
  size_t left_index = 0U;
  size_t right_index = 0U;
  uint32_t count = 0U;
  while (left_index < left_length && right_index < right_length) {
    const uint32_t left_value = left_values[left_index];
    const uint32_t right_value = right_values[right_index];
    const bool left_less = left_value < right_value;
    const bool right_less = right_value < left_value;
    if (!left_less && !right_less) {
      on_match(left_value);
      count += 1U;
    }
    left_index += static_cast<size_t>(!right_less);
    right_index += static_cast<size_t>(!left_less);
  }
  return count;
}

inline uint32_t SparseSparseIntersectionCountAdaptiveExactV4(
    const uint32_t* left_values,
    size_t left_length,
    const uint32_t* right_values,
    size_t right_length) {
  if (left_length < 1U || right_length < 1U) {
    return 0U;
  }
  gSparseCountFastPathCount += 1U;
  if (!ShouldUseSparseAdaptiveSearch(std::min(left_length, right_length), std::max(left_length, right_length))) {
    gSparseEqualSizeMergeCount += 1U;
    return SparseSparseIntersectionCountMerge(left_values, left_length, right_values, right_length);
  }
  gSparseAdaptiveGallopCount += 1U;
  const bool left_is_smaller = left_length <= right_length;
  const uint32_t* smaller_values = left_is_smaller ? left_values : right_values;
  const size_t smaller_length = left_is_smaller ? left_length : right_length;
  const uint32_t* larger_values = left_is_smaller ? right_values : left_values;
  const size_t larger_length = left_is_smaller ? right_length : left_length;
  size_t larger_index = 0U;
  uint32_t count = 0U;
  for (size_t smaller_index = 0U; smaller_index < smaller_length; smaller_index += 1U) {
    const uint32_t value = smaller_values[smaller_index];
    larger_index = GallopingLowerBoundUint32(larger_values, larger_index, larger_length, value);
    if (larger_index >= larger_length) break;
    if (larger_values[larger_index] != value) continue;
    count += 1U;
    larger_index += 1U;
  }
  return count;
}

template <typename OnMatch>
inline uint32_t SparseSparseIntersectionEmitAdaptiveExactV4(
    const uint32_t* left_values,
    size_t left_length,
    const uint32_t* right_values,
    size_t right_length,
    OnMatch on_match) {
  if (left_length < 1U || right_length < 1U) {
    return 0U;
  }
  if (!ShouldUseSparseAdaptiveSearch(std::min(left_length, right_length), std::max(left_length, right_length))) {
    gSparseEqualSizeMergeCount += 1U;
    return SparseSparseIntersectionEmitMerge(
        left_values,
        left_length,
        right_values,
        right_length,
        on_match);
  }
  gSparseAdaptiveGallopCount += 1U;
  const bool left_is_smaller = left_length <= right_length;
  const uint32_t* smaller_values = left_is_smaller ? left_values : right_values;
  const size_t smaller_length = left_is_smaller ? left_length : right_length;
  const uint32_t* larger_values = left_is_smaller ? right_values : left_values;
  const size_t larger_length = left_is_smaller ? right_length : left_length;
  size_t larger_index = 0U;
  uint32_t count = 0U;
  for (size_t smaller_index = 0U; smaller_index < smaller_length; smaller_index += 1U) {
    const uint32_t value = smaller_values[smaller_index];
    larger_index = GallopingLowerBoundUint32(larger_values, larger_index, larger_length, value);
    if (larger_index >= larger_length) break;
    if (larger_values[larger_index] != value) continue;
    on_match(value);
    count += 1U;
    larger_index += 1U;
  }
  return count;
}

inline bool SparseSparseSubsetAdaptiveExactV4(
    const uint32_t* subset_values,
    size_t subset_length,
    const uint32_t* superset_values,
    size_t superset_length) {
  if (subset_length > superset_length) return false;
  if (subset_length < 1U) return true;
  if (!ShouldUseSparseAdaptiveSearch(subset_length, superset_length)) {
    size_t subset_index = 0U;
    size_t superset_index = 0U;
    while (subset_index < subset_length && superset_index < superset_length) {
      const uint32_t subset_value = subset_values[subset_index];
      const uint32_t superset_value = superset_values[superset_index];
      if (subset_value == superset_value) {
        subset_index += 1U;
        superset_index += 1U;
        continue;
      }
      if (subset_value < superset_value) {
        return false;
      }
      superset_index += 1U;
    }
    return subset_index == subset_length;
  }
  size_t superset_index = 0U;
  for (size_t subset_index = 0U; subset_index < subset_length; subset_index += 1U) {
    const uint32_t value = subset_values[subset_index];
    superset_index = GallopingLowerBoundUint32(superset_values, superset_index, superset_length, value);
    if (superset_index >= superset_length || superset_values[superset_index] != value) {
      return false;
    }
    superset_index += 1U;
  }
  return true;
}

inline uint32_t SparseBitmapIntersectionCountExactV4(
    const Uint32View& sparse_values,
    const Uint32View& bitmap_words) {
  gSparseCountFastPathCount += 1U;
  uint32_t count = 0U;
  size_t index = 0U;
  while (index < sparse_values.length) {
    const uint32_t first_value = sparse_values.data[index];
    const uint32_t word_index = first_value >> 5U;
    const uint32_t cached_word = word_index < bitmap_words.length ? bitmap_words.data[word_index] : 0U;
    uint32_t run_mask = 0U;
    do {
      run_mask |= (1U << (sparse_values.data[index] & 31U));
      index += 1U;
    } while (index < sparse_values.length && (sparse_values.data[index] >> 5U) == word_index);
    gSparseBitmapWordRunCount += 1U;
    const uint32_t matched_mask = cached_word & run_mask;
    if (matched_mask == 0U) {
      gSparseBitmapSkippedRunCount += 1U;
      continue;
    }
    if (matched_mask == run_mask) {
      gSparseBitmapFullRunHitCount += 1U;
      count += static_cast<uint32_t>(Popcount32(run_mask));
      continue;
    }
    gSparseBitmapPartialRunCount += 1U;
    count += Popcount32(matched_mask);
  }
  return count;
}

template <typename OnFullRun, typename OnValue>
inline uint32_t SparseBitmapIntersectionEmitExactV4(
    const Uint32View& sparse_values,
    const Uint32View& bitmap_words,
    OnFullRun on_full_run,
    OnValue on_value) {
  uint32_t count = 0U;
  size_t index = 0U;
  while (index < sparse_values.length) {
    const size_t run_start = index;
    const uint32_t first_value = sparse_values.data[index];
    const uint32_t word_index = first_value >> 5U;
    const uint32_t cached_word = word_index < bitmap_words.length ? bitmap_words.data[word_index] : 0U;
    uint32_t run_mask = 0U;
    do {
      run_mask |= (1U << (sparse_values.data[index] & 31U));
      index += 1U;
    } while (index < sparse_values.length && (sparse_values.data[index] >> 5U) == word_index);
    gSparseBitmapWordRunCount += 1U;
    const uint32_t matched_mask = cached_word & run_mask;
    if (matched_mask == 0U) {
      gSparseBitmapSkippedRunCount += 1U;
      continue;
    }
    if (matched_mask == run_mask) {
      gSparseBitmapFullRunHitCount += 1U;
      count += static_cast<uint32_t>(index - run_start);
      on_full_run(run_start, index, word_index, run_mask);
      continue;
    }
    gSparseBitmapPartialRunCount += 1U;
    for (size_t run_index = run_start; run_index < index; run_index += 1U) {
      const uint32_t current_value = sparse_values.data[run_index];
      if ((matched_mask & (1U << (current_value & 31U))) != 0U) {
        on_value(current_value);
        count += 1U;
      }
    }
  }
  return count;
}

inline bool SparseBitmapSubsetExactV4(const Uint32View& subset_values, const Uint32View& superset_words) {
  size_t index = 0U;
  while (index < subset_values.length) {
    const uint32_t first_value = subset_values.data[index];
    const uint32_t word_index = first_value >> 5U;
    const uint32_t superset_word = word_index < superset_words.length ? superset_words.data[word_index] : 0U;
    uint32_t required_mask = 0U;
    do {
      required_mask |= (1U << (subset_values.data[index] & 31U));
      index += 1U;
    } while (index < subset_values.length && (subset_values.data[index] >> 5U) == word_index);
    if ((superset_word & required_mask) != required_mask) {
      return false;
    }
  }
  return true;
}

inline bool FindFirstBitmapValue(const uint32_t* words, size_t length, uint32_t* out_value) {
  for (size_t word_index = 0U; word_index < length; word_index += 1U) {
    const uint32_t word = words[word_index];
    if (word == 0U) continue;
    *out_value = static_cast<uint32_t>(word_index * 32U + TrailingZeroCount32(word));
    return true;
  }
  return false;
}

inline bool FindLastBitmapValue(const uint32_t* words, size_t length, uint32_t* out_value) {
  for (size_t word_index = length; word_index > 0U; word_index -= 1U) {
    const uint32_t word = words[word_index - 1U];
    if (word == 0U) continue;
    *out_value = static_cast<uint32_t>((word_index - 1U) * 32U + MostSignificantBitIndex32(word));
    return true;
  }
  return false;
}

inline void EncodeDeltaVarint(uint32_t delta, std::vector<uint8_t>* out) {
  uint32_t next_delta = delta;
  while (next_delta >= 0x80U) {
    out->push_back(static_cast<uint8_t>((next_delta & 0x7fU) | 0x80U));
    next_delta >>= 7U;
  }
  out->push_back(static_cast<uint8_t>(next_delta));
}

inline bool MergeShiftedDeltaSegment(
    napi_env env,
    const uint8_t* bytes,
    size_t length,
    uint32_t row_offset,
    uint32_t expected_count,
    std::vector<uint8_t>* merged_bytes,
    uint32_t* total_count,
    bool* has_values,
    uint32_t* first_row_idx,
    uint32_t* last_row_idx) {
  uint64_t previous_local = 0U;
  uint64_t decoded_value = 0U;
  uint32_t shift = 0U;
  uint32_t local_count = 0U;
  for (size_t byte_index = 0; byte_index < length; byte_index += 1U) {
    const uint8_t byte = bytes[byte_index];
    decoded_value |= static_cast<uint64_t>(byte & 0x7fU) << shift;
    if ((byte & 0x80U) == 0U) {
      if (decoded_value > std::numeric_limits<uint32_t>::max()) {
        ThrowError(env, "Perfect prototype shifted-delta merge exceeded uint32 delta range");
        return false;
      }
      previous_local += decoded_value;
      if (previous_local > std::numeric_limits<uint32_t>::max()) {
        ThrowError(env, "Perfect prototype shifted-delta merge exceeded uint32 local row index range");
        return false;
      }
      const uint64_t shifted_value64 = previous_local + static_cast<uint64_t>(row_offset);
      if (shifted_value64 > std::numeric_limits<uint32_t>::max()) {
        ThrowError(env, "Perfect prototype shifted-delta merge exceeded uint32 shifted row index range");
        return false;
      }
      const uint32_t shifted_value = static_cast<uint32_t>(shifted_value64);
      if (*has_values && shifted_value <= *last_row_idx) {
        ThrowError(env, "Perfect prototype shifted-delta merge encountered non-monotonic shifted row indexes");
        return false;
      }
      const uint32_t delta = *has_values ? (shifted_value - *last_row_idx) : shifted_value;
      EncodeDeltaVarint(delta, merged_bytes);
      if (!*has_values) {
        *first_row_idx = shifted_value;
        *has_values = true;
      }
      *last_row_idx = shifted_value;
      *total_count += 1U;
      local_count += 1U;
      decoded_value = 0U;
      shift = 0U;
      if (local_count >= expected_count) {
        break;
      }
    } else {
      shift += 7U;
      if (shift > 35U) {
        ThrowError(env, "Perfect prototype shifted-delta merge encountered malformed varint");
        return false;
      }
    }
  }
  if (shift != 0U || decoded_value != 0U) {
    ThrowError(env, "Perfect prototype shifted-delta merge encountered unterminated varint");
    return false;
  }
  if (local_count != expected_count) {
    ThrowError(env, "Perfect prototype shifted-delta merge count mismatch");
    return false;
  }
  return true;
}

inline bool ReadExactFdRange(
    napi_env env,
    int32_t fd,
    uint64_t offset_value,
    uint32_t byte_length,
    std::vector<uint8_t>* out) {
  if (fd < 0) {
    ThrowError(env, "Perfect prototype shifted-delta file merge requires a non-negative file descriptor");
    return false;
  }
  if (byte_length == 0U) {
    out->clear();
    return true;
  }
  if (offset_value > static_cast<uint64_t>(std::numeric_limits<off_t>::max())) {
    ThrowError(env, "Perfect prototype shifted-delta file merge offset exceeded supported range");
    return false;
  }
  out->assign(static_cast<size_t>(byte_length), 0U);
  size_t total_read = 0U;
  while (total_read < out->size()) {
    ssize_t bytes_read = pread(
        fd,
        out->data() + total_read,
        out->size() - total_read,
        static_cast<off_t>(offset_value) + static_cast<off_t>(total_read));
    if (bytes_read == 0) {
      ThrowError(env, "Perfect prototype shifted-delta file merge encountered short read");
      return false;
    }
    if (bytes_read < 0) {
      ThrowError(env, (std::string("Perfect prototype shifted-delta file merge read failed: errno=") + std::to_string(errno)).c_str());
      return false;
    }
    total_read += static_cast<size_t>(bytes_read);
  }
  return true;
}

inline bool WriteExactFdRange(
    napi_env env,
    int32_t fd,
    uint64_t offset_value,
    const uint8_t* bytes,
    size_t byte_length) {
  if (fd < 0) {
    ThrowError(env, "Perfect prototype shifted-delta file write requires a non-negative file descriptor");
    return false;
  }
  if (offset_value > static_cast<uint64_t>(std::numeric_limits<off_t>::max())) {
    ThrowError(env, "Perfect prototype shifted-delta file write offset exceeded supported range");
    return false;
  }
  size_t total_written = 0U;
  while (total_written < byte_length) {
    ssize_t bytes_written = pwrite(
        fd,
        bytes + total_written,
        byte_length - total_written,
        static_cast<off_t>(offset_value) + static_cast<off_t>(total_written));
    if (bytes_written <= 0) {
      ThrowError(env, (std::string("Perfect prototype shifted-delta file write failed: errno=") + std::to_string(errno)).c_str());
      return false;
    }
    total_written += static_cast<size_t>(bytes_written);
  }
  return true;
}

inline bool CopyFdRange(
    napi_env env,
    int32_t source_fd,
    uint64_t source_offset,
    uint32_t byte_length,
    int32_t target_fd,
    uint64_t target_offset) {
  if (byte_length == 0U) return true;
  constexpr size_t kCopyChunkBytes = 64U * 1024U;
  std::vector<uint8_t> scratch(std::min(static_cast<size_t>(byte_length), kCopyChunkBytes), 0U);
  size_t copied = 0U;
  while (copied < static_cast<size_t>(byte_length)) {
    const size_t chunk = std::min(scratch.size(), static_cast<size_t>(byte_length) - copied);
    if (!ReadExactFdRange(
            env,
            source_fd,
            source_offset + static_cast<uint64_t>(copied),
            static_cast<uint32_t>(chunk),
            &scratch)) {
      return false;
    }
    if (!WriteExactFdRange(
            env,
            target_fd,
            target_offset + static_cast<uint64_t>(copied),
            scratch.data(),
            chunk)) {
      return false;
    }
    copied += chunk;
  }
  return true;
}

inline bool ReadFirstDeltaVarintFromFd(
    napi_env env,
    int32_t fd,
    uint64_t offset_value,
    uint32_t byte_length,
    uint32_t* decoded_delta,
    uint32_t* consumed_bytes) {
  if (byte_length < 1U) {
    ThrowError(env, "Perfect prototype postings splice requires a positive byte length for non-empty refs");
    return false;
  }
  uint64_t value = 0U;
  uint32_t shift = 0U;
  for (uint32_t byte_index = 0U; byte_index < byte_length; byte_index += 1U) {
    uint8_t byte = 0U;
    std::vector<uint8_t> scratch(1U, 0U);
    if (!ReadExactFdRange(env, fd, offset_value + byte_index, 1U, &scratch)) {
      return false;
    }
    byte = scratch[0];
    value |= static_cast<uint64_t>(byte & 0x7fU) << shift;
    if ((byte & 0x80U) == 0U) {
      if (value > std::numeric_limits<uint32_t>::max()) {
        ThrowError(env, "Perfect prototype postings splice first delta exceeded uint32 range");
        return false;
      }
      *decoded_delta = static_cast<uint32_t>(value);
      *consumed_bytes = byte_index + 1U;
      return true;
    }
    shift += 7U;
    if (shift > 35U) {
      ThrowError(env, "Perfect prototype postings splice encountered malformed first varint");
      return false;
    }
  }
  ThrowError(env, "Perfect prototype postings splice encountered unterminated first varint");
  return false;
}

inline bool BitIsSet(const Uint32View& words, uint32_t value) {
  const size_t word_index = static_cast<size_t>(value >> 5U);
  if (word_index >= words.length) {
    return false;
  }
  const uint32_t bit_offset = value & 31U;
  return ((words.data[word_index] >> bit_offset) & 1U) == 1U;
}

inline bool DecodeDeltaVarints(
    napi_env env,
    const uint8_t* bytes,
    size_t length,
    bool count_present,
    uint32_t expected_count,
    std::vector<uint32_t>* out) {
  out->clear();
  if (count_present) {
    out->reserve(expected_count);
  }
  uint64_t previous = 0;
  uint64_t value = 0;
  uint32_t shift = 0;
  for (size_t index = 0; index < length; index += 1) {
    const uint8_t byte = bytes[index];
    value |= static_cast<uint64_t>(byte & 0x7fU) << shift;
    if ((byte & 0x80U) == 0U) {
      if (value > std::numeric_limits<uint32_t>::max()) {
        ThrowError(env, "Perfect prototype native decode exceeded uint32 delta range");
        return false;
      }
      previous += value;
      if (previous > std::numeric_limits<uint32_t>::max()) {
        ThrowError(env, "Perfect prototype native decode exceeded uint32 row index range");
        return false;
      }
      out->push_back(static_cast<uint32_t>(previous));
      value = 0;
      shift = 0;
      if (count_present && out->size() >= expected_count) {
        break;
      }
      continue;
    }
    shift += 7U;
    if (shift > 35U) {
      ThrowError(env, "Perfect prototype native decode encountered malformed varint");
      return false;
    }
  }
  if (shift != 0U || value != 0U) {
    ThrowError(env, "Perfect prototype native decode encountered unterminated varint");
    return false;
  }
  if (count_present && out->size() != expected_count) {
    ThrowError(env, "Perfect prototype native decode count mismatch");
    return false;
  }
  return true;
}

inline napi_value CreateBitmapResult(napi_env env, const std::vector<uint32_t>& words, uint32_t count, uint32_t universe_size) {
  napi_value result;
  if (napi_create_object(env, &result) != napi_ok) {
    return ThrowError(env, "Failed to create bitmap decode result");
  }
  napi_value words_array = CreateUint32ArrayCopy(env, words.data(), words.size());
  if (words_array == nullptr) {
    return nullptr;
  }
  if (napi_set_named_property(env, result, "words", words_array) != napi_ok) {
    return ThrowError(env, "Failed to set bitmap words");
  }
  if (!SetNamedUint32(env, result, "count", count)) {
    return nullptr;
  }
  if (!SetNamedUint32(env, result, "universeSize", universe_size)) {
    return nullptr;
  }
  return result;
}

inline napi_value CreateShiftedDeltaMergeResult(
    napi_env env,
    const std::vector<uint8_t>& bytes,
    uint32_t count,
    bool has_values,
    uint32_t first_row_idx,
    uint32_t last_row_idx) {
  napi_value result;
  if (napi_create_object(env, &result) != napi_ok) {
    return ThrowError(env, "Failed to create shifted-delta merge result");
  }
  void* buffer_data = nullptr;
  napi_value buffer_value;
  if (napi_create_buffer_copy(env, bytes.size(), bytes.empty() ? nullptr : bytes.data(), &buffer_data, &buffer_value) != napi_ok) {
    return ThrowError(env, "Failed to allocate shifted-delta merge buffer");
  }
  if (napi_set_named_property(env, result, "buffer", buffer_value) != napi_ok) {
    return ThrowError(env, "Failed to set shifted-delta merge buffer");
  }
  if (!SetNamedUint32(env, result, "count", count)) {
    return nullptr;
  }
  napi_value first_value;
  napi_value last_value;
  if (has_values) {
    if (napi_create_uint32(env, first_row_idx, &first_value) != napi_ok ||
        napi_create_uint32(env, last_row_idx, &last_value) != napi_ok) {
      return ThrowError(env, "Failed to create shifted-delta merge range values");
    }
  } else {
    if (napi_get_null(env, &first_value) != napi_ok || napi_get_null(env, &last_value) != napi_ok) {
      return ThrowError(env, "Failed to create shifted-delta merge null range values");
    }
  }
  if (napi_set_named_property(env, result, "firstRowIdx", first_value) != napi_ok ||
      napi_set_named_property(env, result, "lastRowIdx", last_value) != napi_ok) {
    return ThrowError(env, "Failed to set shifted-delta merge range values");
  }
  return result;
}

inline napi_value NativeSparseSparseIntersectionCount(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 2, &argc, &argv)) return nullptr;
  Uint32View left;
  Uint32View right;
  if (argc < 2 || !GetUint32ArrayView(env, argv[0], "leftValues", &left) ||
      !GetUint32ArrayView(env, argv[1], "rightValues", &right)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  const uint32_t count = SparseSparseIntersectionCountAdaptiveExactV4(
      left.data,
      left.length,
      right.data,
      right.length);
  napi_value result;
  napi_create_uint32(env, count, &result);
  return result;
}

inline napi_value NativeSparseSparseIntersectionCountBatch(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 2, &argc, &argv)) return nullptr;
  Uint32View left;
  std::vector<Uint32View> right_views;
  if (argc < 2 || !GetUint32ArrayView(env, argv[0], "leftValues", &left) ||
      !GetUint32ArrayViewList(env, argv[1], "rightValuesList", &right_views)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  std::vector<uint32_t> counts;
  counts.reserve(right_views.size());
  for (const auto& right : right_views) {
    counts.push_back(
        SparseSparseIntersectionCountAdaptiveExactV4(
            left.data,
            left.length,
            right.data,
            right.length));
  }
  return CreateUint32ArrayCopy(env, counts.data(), counts.size());
}

inline napi_value NativeSparseSparseIntersectionValues(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 2, &argc, &argv)) return nullptr;
  Uint32View left;
  Uint32View right;
  if (argc < 2 || !GetUint32ArrayView(env, argv[0], "leftValues", &left) ||
      !GetUint32ArrayView(env, argv[1], "rightValues", &right)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  std::vector<uint32_t> out;
  out.reserve(std::min(left.length, right.length));
  SparseSparseIntersectionEmitAdaptiveExactV4(
      left.data,
      left.length,
      right.data,
      right.length,
      [&out](uint32_t value) { out.push_back(value); });
  return CreateUint32ArrayCopy(env, out.data(), out.size());
}

inline napi_value NativeSparseSparseIntersectionFill(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 3, &argc, &argv)) return nullptr;
  Uint32View left;
  Uint32View right;
  MutableUint32View out_values;
  if (argc < 3 || !GetUint32ArrayView(env, argv[0], "leftValues", &left) ||
      !GetUint32ArrayView(env, argv[1], "rightValues", &right) ||
      !GetMutableUint32ArrayView(env, argv[2], "outValues", &out_values)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  size_t out_index = 0;
  bool overflow = false;
  SparseSparseIntersectionEmitAdaptiveExactV4(
      left.data,
      left.length,
      right.data,
      right.length,
      [&out_values, &out_index, &overflow](uint32_t value) {
        if (out_index >= out_values.length) {
          overflow = true;
          return;
        }
        out_values.data[out_index] = value;
        out_index += 1U;
      });
  if (overflow) {
    return ThrowError(env, "Perfect prototype sparse/sparse fill output buffer too small");
  }
  return CreateUint32Result(env, static_cast<uint32_t>(out_index));
}

inline napi_value NativeSparseBitmapIntersectionCount(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 2, &argc, &argv)) return nullptr;
  Uint32View sparse_values;
  Uint32View bitmap_words;
  if (argc < 2 || !GetUint32ArrayView(env, argv[0], "sparseValues", &sparse_values) ||
      !GetUint32ArrayView(env, argv[1], "bitmapWords", &bitmap_words)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  const uint32_t count = SparseBitmapIntersectionCountExactV4(
      sparse_values,
      bitmap_words);
  napi_value result;
  napi_create_uint32(env, count, &result);
  return result;
}

inline napi_value NativeSparseBitmapIntersectionCountBatch(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 2, &argc, &argv)) return nullptr;
  Uint32View sparse_values;
  std::vector<Uint32View> bitmap_words_list;
  if (argc < 2 || !GetUint32ArrayView(env, argv[0], "sparseValues", &sparse_values) ||
      !GetUint32ArrayViewList(env, argv[1], "bitmapWordsList", &bitmap_words_list)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  std::vector<uint32_t> counts;
  counts.reserve(bitmap_words_list.size());
  for (const auto& bitmap_words : bitmap_words_list) {
    counts.push_back(
        SparseBitmapIntersectionCountExactV4(
            sparse_values,
            bitmap_words));
  }
  return CreateUint32ArrayCopy(env, counts.data(), counts.size());
}

inline napi_value NativeBitmapSparseIntersectionCountBatch(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 2, &argc, &argv)) return nullptr;
  Uint32View bitmap_words;
  std::vector<Uint32View> sparse_values_list;
  if (argc < 2 || !GetUint32ArrayView(env, argv[0], "bitmapWords", &bitmap_words) ||
      !GetUint32ArrayViewList(env, argv[1], "sparseValuesList", &sparse_values_list)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  std::vector<uint32_t> counts;
  counts.reserve(sparse_values_list.size());
  for (const auto& sparse_values : sparse_values_list) {
    counts.push_back(
        SparseBitmapIntersectionCountExactV4(
            sparse_values,
            bitmap_words));
  }
  return CreateUint32ArrayCopy(env, counts.data(), counts.size());
}

inline napi_value NativeSparseBitmapIntersectionValues(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 2, &argc, &argv)) return nullptr;
  Uint32View sparse_values;
  Uint32View bitmap_words;
  if (argc < 2 || !GetUint32ArrayView(env, argv[0], "sparseValues", &sparse_values) ||
      !GetUint32ArrayView(env, argv[1], "bitmapWords", &bitmap_words)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  std::vector<uint32_t> out;
  out.reserve(sparse_values.length);
  SparseBitmapIntersectionEmitExactV4(
      sparse_values,
      bitmap_words,
      [&out, &sparse_values](size_t run_start, size_t run_end, uint32_t, uint32_t) {
        out.insert(out.end(), sparse_values.data + run_start, sparse_values.data + run_end);
      },
      [&out](uint32_t value) { out.push_back(value); });
  return CreateUint32ArrayCopy(env, out.data(), out.size());
}

inline napi_value NativeSparseBitmapIntersectionValuesFill(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 3, &argc, &argv)) return nullptr;
  Uint32View sparse_values;
  Uint32View bitmap_words;
  MutableUint32View out_values;
  if (argc < 3 || !GetUint32ArrayView(env, argv[0], "sparseValues", &sparse_values) ||
      !GetUint32ArrayView(env, argv[1], "bitmapWords", &bitmap_words) ||
      !GetMutableUint32ArrayView(env, argv[2], "outValues", &out_values)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  size_t out_index = 0;
  bool overflow = false;
  SparseBitmapIntersectionEmitExactV4(
      sparse_values,
      bitmap_words,
      [&out_values, &sparse_values, &out_index, &overflow](size_t run_start, size_t run_end, uint32_t, uint32_t) {
        const size_t run_length = run_end - run_start;
        if (out_index + run_length > out_values.length) {
          overflow = true;
          return;
        }
        std::memcpy(
            out_values.data + out_index,
            sparse_values.data + run_start,
            run_length * sizeof(uint32_t));
        out_index += run_length;
      },
      [&out_values, &out_index, &overflow](uint32_t value) {
        if (out_index >= out_values.length) {
          overflow = true;
          return;
        }
        out_values.data[out_index] = value;
        out_index += 1U;
      });
  if (overflow) {
    return ThrowError(env, "Perfect prototype sparse/bitmap fill output buffer too small");
  }
  return CreateUint32Result(env, static_cast<uint32_t>(out_index));
}

inline napi_value NativeSparseBitmapIntersectionWords(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 3, &argc, &argv)) return nullptr;
  Uint32View sparse_values;
  Uint32View bitmap_words;
  uint32_t universe_size = 0;
  if (argc < 3 || !GetUint32ArrayView(env, argv[0], "sparseValues", &sparse_values) ||
      !GetUint32ArrayView(env, argv[1], "bitmapWords", &bitmap_words) ||
      !GetRequiredUint32(env, argv[2], "universeSize", &universe_size)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  if (universe_size < 1U) {
    return ThrowError(env, "Perfect prototype native sparse/bitmap dense intersection requires universeSize > 0");
  }
  std::vector<uint32_t> words(RequiredBitmapWordCount(universe_size), 0U);
  bool overflow = false;
  const uint32_t count = SparseBitmapIntersectionEmitExactV4(
      sparse_values,
      bitmap_words,
      [&words, universe_size, &overflow](size_t, size_t, uint32_t word_index, uint32_t run_mask) {
        uint32_t effective_mask = run_mask;
        if (!ValidateBitmapMaskForUniverse(universe_size, word_index, &effective_mask)) {
          overflow = true;
          return;
        }
        words[word_index] |= effective_mask;
      },
      [&words, universe_size, &overflow](uint32_t value) {
        if (value >= universe_size) {
          overflow = true;
          return;
        }
        words[static_cast<size_t>(value >> 5U)] |= (1U << (value & 31U));
      });
  if (overflow) {
    return ThrowError(
        env,
        "Perfect prototype native sparse/bitmap dense intersection exceeded explicit universeSize");
  }
  return CreateBitmapResult(env, words, count, universe_size);
}

inline napi_value NativeSparseBitmapIntersectionWordsFill(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 4, &argc, &argv)) return nullptr;
  Uint32View sparse_values;
  Uint32View bitmap_words;
  MutableUint32View out_words;
  uint32_t universe_size = 0;
  if (argc < 4 || !GetUint32ArrayView(env, argv[0], "sparseValues", &sparse_values) ||
      !GetUint32ArrayView(env, argv[1], "bitmapWords", &bitmap_words) ||
      !GetMutableUint32ArrayView(env, argv[2], "outWords", &out_words) ||
      !GetRequiredUint32(env, argv[3], "universeSize", &universe_size)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  const size_t required_words = RequiredBitmapWordCount(universe_size);
  if (out_words.length != required_words) {
    return ThrowError(env, "Perfect prototype sparse/bitmap words fill length mismatch");
  }
  if (universe_size < 1U) {
    return ThrowError(env, "Perfect prototype native sparse/bitmap dense intersection requires universeSize > 0");
  }
  std::memset(out_words.data, 0, out_words.length * sizeof(uint32_t));
  bool overflow = false;
  const uint32_t count = SparseBitmapIntersectionEmitExactV4(
      sparse_values,
      bitmap_words,
      [&out_words, universe_size, &overflow](size_t, size_t, uint32_t word_index, uint32_t run_mask) {
        uint32_t effective_mask = run_mask;
        if (!ValidateBitmapMaskForUniverse(universe_size, word_index, &effective_mask)) {
          overflow = true;
          return;
        }
        out_words.data[word_index] |= effective_mask;
      },
      [&out_words, universe_size, &overflow](uint32_t value) {
        if (value >= universe_size) {
          overflow = true;
          return;
        }
        out_words.data[static_cast<size_t>(value >> 5U)] |= (1U << (value & 31U));
      });
  if (overflow) {
    return ThrowError(
        env,
        "Perfect prototype native sparse/bitmap dense intersection exceeded explicit universeSize");
  }
  return CreateUint32Result(env, count);
}

inline napi_value NativeBitmapBitmapIntersectionCount(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 2, &argc, &argv)) return nullptr;
  Uint32View left_words;
  Uint32View right_words;
  if (argc < 2 || !GetUint32ArrayView(env, argv[0], "leftWords", &left_words) ||
      !GetUint32ArrayView(env, argv[1], "rightWords", &right_words)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  const size_t limit = std::min(left_words.length, right_words.length);
  const uint32_t count = BitmapBitmapIntersectionCountAvx2(left_words.data, right_words.data, limit);
  napi_value result;
  napi_create_uint32(env, count, &result);
  return result;
}

inline napi_value NativeBitmapBitmapIntersectionCountBatch(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 2, &argc, &argv)) return nullptr;
  Uint32View left_words;
  std::vector<Uint32View> right_words_list;
  if (argc < 2 || !GetUint32ArrayView(env, argv[0], "leftWords", &left_words) ||
      !GetUint32ArrayViewList(env, argv[1], "rightWordsList", &right_words_list)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  std::vector<uint32_t> counts;
  counts.reserve(right_words_list.size());
  for (const auto& right_words : right_words_list) {
    const size_t limit = std::min(left_words.length, right_words.length);
    counts.push_back(
        BitmapBitmapIntersectionCountAvx2(
            left_words.data,
            right_words.data,
            limit));
  }
  return CreateUint32ArrayCopy(env, counts.data(), counts.size());
}

inline napi_value NativeBitmapBitmapIntersectionWords(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 3, &argc, &argv)) return nullptr;
  Uint32View left_words;
  Uint32View right_words;
  uint32_t universe_size = 0;
  if (argc < 3 || !GetUint32ArrayView(env, argv[0], "leftWords", &left_words) ||
      !GetUint32ArrayView(env, argv[1], "rightWords", &right_words) ||
      !GetRequiredUint32(env, argv[2], "universeSize", &universe_size)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  if (universe_size < 1U) {
    return ThrowError(env, "Perfect prototype native bitset/bitset dense intersection requires universeSize > 0");
  }
  const size_t limit = std::min(left_words.length, right_words.length);
  const size_t required_words = RequiredBitmapWordCount(universe_size);
  if (limit < required_words) {
    return ThrowError(env, "Perfect prototype native bitset/bitset dense intersection words shorter than universeSize");
  }
  std::vector<uint32_t> out(limit, 0U);
  const uint32_t count = BitmapBitmapIntersectionWordsFillAvx2(
      left_words.data,
      right_words.data,
      limit,
      out.data());
  if (!ValidateBitmapWordsAgainstUniverse(out.data(), out.size(), universe_size)) {
    return ThrowError(
        env,
        "Perfect prototype native bitset/bitset dense intersection exceeded explicit universeSize");
  }
  out.resize(required_words);
  return CreateBitmapResult(env, out, count, universe_size);
}

inline napi_value NativeBitmapBitmapIntersectionWordsFill(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 4, &argc, &argv)) return nullptr;
  Uint32View left_words;
  Uint32View right_words;
  MutableUint32View out_words;
  uint32_t universe_size = 0;
  if (argc < 4 || !GetUint32ArrayView(env, argv[0], "leftWords", &left_words) ||
      !GetUint32ArrayView(env, argv[1], "rightWords", &right_words) ||
      !GetMutableUint32ArrayView(env, argv[2], "outWords", &out_words) ||
      !GetRequiredUint32(env, argv[3], "universeSize", &universe_size)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  const size_t limit = std::min(left_words.length, right_words.length);
  if (universe_size < 1U) {
    return ThrowError(env, "Perfect prototype native bitset/bitset dense intersection requires universeSize > 0");
  }
  const size_t required_words = RequiredBitmapWordCount(universe_size);
  if (limit < required_words) {
    return ThrowError(env, "Perfect prototype native bitset/bitset dense intersection words shorter than universeSize");
  }
  if (out_words.length != required_words) {
    return ThrowError(env, "Perfect prototype bitset/bitset words fill length mismatch");
  }
  uint32_t count = 0U;
  if (limit == required_words) {
    count = BitmapBitmapIntersectionWordsFillAvx2(
        left_words.data,
        right_words.data,
        limit,
        out_words.data);
    if (!ValidateBitmapWordsAgainstUniverse(out_words.data, out_words.length, universe_size)) {
      return ThrowError(
          env,
          "Perfect prototype native bitset/bitset dense intersection exceeded explicit universeSize");
    }
  } else {
    std::vector<uint32_t> temp(limit, 0U);
    count = BitmapBitmapIntersectionWordsFillAvx2(
        left_words.data,
        right_words.data,
        limit,
        temp.data());
    if (!ValidateBitmapWordsAgainstUniverse(temp.data(), temp.size(), universe_size)) {
      return ThrowError(
          env,
          "Perfect prototype native bitset/bitset dense intersection exceeded explicit universeSize");
    }
    std::memcpy(out_words.data, temp.data(), required_words * sizeof(uint32_t));
  }
  return CreateUint32Result(env, count);
}

inline napi_value NativeBitmapMaterializeValues(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 2, &argc, &argv)) return nullptr;
  Uint32View words;
  uint32_t expected_count = 0;
  bool count_present = false;
  if (argc < 1 || !GetUint32ArrayView(env, argv[0], "bitmapWords", &words)) {
    delete[] argv;
    return nullptr;
  }
  if (argc >= 2 && !GetOptionalUint32(env, argv[1], &expected_count, &count_present)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  std::vector<uint32_t> out;
  if (count_present) {
    out.reserve(expected_count);
  }
  size_t word_index = 0U;
  alignas(32) uint64_t lanes[4] = {0U, 0U, 0U, 0U};
  for (; word_index + 8U <= words.length; word_index += 8U) {
    const __m256i vector = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(words.data + word_index));
    if (_mm256_testz_si256(vector, vector) != 0) {
      continue;
    }
    _mm256_storeu_si256(reinterpret_cast<__m256i*>(lanes), vector);
    const uint32_t base_value = static_cast<uint32_t>(word_index * 32U);
    for (uint32_t lane_index = 0U; lane_index < 4U; lane_index += 1U) {
      uint64_t lane_word = lanes[lane_index];
      const uint32_t lane_base = base_value + lane_index * 64U;
      while (lane_word != 0U) {
        const uint32_t bit_index = TrailingZeroCount64(lane_word);
        out.push_back(lane_base + bit_index);
        lane_word &= lane_word - 1U;
      }
    }
  }
  for (; word_index < words.length; word_index += 1U) {
    uint32_t word = words.data[word_index];
    while (word != 0U) {
      const uint32_t bit_index = TrailingZeroCount32(word);
      out.push_back(static_cast<uint32_t>(word_index * 32U + bit_index));
      word &= word - 1U;
    }
  }
  if (count_present && out.size() != expected_count) {
    return ThrowError(env, "Perfect prototype native bitmap materialization count mismatch");
  }
  return CreateUint32ArrayCopy(env, out.data(), out.size());
}

inline napi_value NativeBitmapEdgeSummary(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 1, &argc, &argv)) return nullptr;
  Uint32View words;
  if (argc < 1 || !GetUint32ArrayView(env, argv[0], "bitmapWords", &words)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  uint32_t first_value = 0U;
  uint32_t last_value = 0U;
  const bool has_first = FindFirstBitmapValue(words.data, words.length, &first_value);
  const bool has_last = has_first && FindLastBitmapValue(words.data, words.length, &last_value);
  napi_value result;
  if (napi_create_object(env, &result) != napi_ok) {
    return ThrowError(env, "Failed to create bitmap edge summary result");
  }
  napi_value first_value_node;
  napi_value last_value_node;
  if (has_first && has_last) {
    if (napi_create_int32(env, static_cast<int32_t>(first_value), &first_value_node) != napi_ok ||
        napi_create_int32(env, static_cast<int32_t>(last_value), &last_value_node) != napi_ok) {
      return ThrowError(env, "Failed to create bitmap edge summary values");
    }
  } else {
    if (napi_create_int32(env, -1, &first_value_node) != napi_ok ||
        napi_create_int32(env, -1, &last_value_node) != napi_ok) {
      return ThrowError(env, "Failed to create bitmap edge summary empty values");
    }
  }
  if (napi_set_named_property(env, result, "firstValue", first_value_node) != napi_ok ||
      napi_set_named_property(env, result, "lastValue", last_value_node) != napi_ok) {
    return ThrowError(env, "Failed to set bitmap edge summary values");
  }
  return result;
}

inline napi_value NativeBitmapBitmapIntersectionValues(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 2, &argc, &argv)) return nullptr;
  Uint32View left_words;
  Uint32View right_words;
  if (argc < 2 || !GetUint32ArrayView(env, argv[0], "leftWords", &left_words) ||
      !GetUint32ArrayView(env, argv[1], "rightWords", &right_words)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  const size_t limit = std::min(left_words.length, right_words.length);
  std::vector<uint32_t> out;
  size_t word_index = 0U;
  alignas(32) uint64_t lanes[4] = {0U, 0U, 0U, 0U};
  for (; word_index + 8U <= limit; word_index += 8U) {
    const __m256i left = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(left_words.data + word_index));
    const __m256i right = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(right_words.data + word_index));
    const __m256i intersected = _mm256_and_si256(left, right);
    if (_mm256_testz_si256(intersected, intersected) != 0) {
      continue;
    }
    _mm256_storeu_si256(reinterpret_cast<__m256i*>(lanes), intersected);
    const uint32_t base_value = static_cast<uint32_t>(word_index * 32U);
    for (uint32_t lane_index = 0U; lane_index < 4U; lane_index += 1U) {
      uint64_t lane_word = lanes[lane_index];
      const uint32_t lane_base = base_value + lane_index * 64U;
      while (lane_word != 0U) {
        const uint32_t bit_index = TrailingZeroCount64(lane_word);
        out.push_back(lane_base + bit_index);
        lane_word &= lane_word - 1U;
      }
    }
  }
  for (; word_index < limit; word_index += 1U) {
    uint32_t word = left_words.data[word_index] & right_words.data[word_index];
    while (word != 0U) {
      const uint32_t bit_index = TrailingZeroCount32(word);
      out.push_back(static_cast<uint32_t>(word_index * 32U + bit_index));
      word &= word - 1U;
    }
  }
  return CreateUint32ArrayCopy(env, out.data(), out.size());
}

inline napi_value NativeBitmapBitmapIntersectionValuesFill(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 3, &argc, &argv)) return nullptr;
  Uint32View left_words;
  Uint32View right_words;
  MutableUint32View out_values;
  if (argc < 3 || !GetUint32ArrayView(env, argv[0], "leftWords", &left_words) ||
      !GetUint32ArrayView(env, argv[1], "rightWords", &right_words) ||
      !GetMutableUint32ArrayView(env, argv[2], "outValues", &out_values)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  const size_t limit = std::min(left_words.length, right_words.length);
  size_t out_index = 0;
  size_t word_index = 0U;
  alignas(32) uint64_t lanes[4] = {0U, 0U, 0U, 0U};
  for (; word_index + 8U <= limit; word_index += 8U) {
    const __m256i left = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(left_words.data + word_index));
    const __m256i right = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(right_words.data + word_index));
    const __m256i intersected = _mm256_and_si256(left, right);
    if (_mm256_testz_si256(intersected, intersected) != 0) {
      continue;
    }
    _mm256_storeu_si256(reinterpret_cast<__m256i*>(lanes), intersected);
    const uint32_t base_value = static_cast<uint32_t>(word_index * 32U);
    for (uint32_t lane_index = 0U; lane_index < 4U; lane_index += 1U) {
      uint64_t lane_word = lanes[lane_index];
      const uint32_t lane_base = base_value + lane_index * 64U;
      while (lane_word != 0U) {
        if (out_index >= out_values.length) {
          return ThrowError(env, "Perfect prototype bitset/bitset fill output buffer too small");
        }
        const uint32_t bit_index = TrailingZeroCount64(lane_word);
        out_values.data[out_index] = lane_base + bit_index;
        out_index += 1U;
        lane_word &= lane_word - 1U;
      }
    }
  }
  for (; word_index < limit; word_index += 1U) {
    uint32_t word = left_words.data[word_index] & right_words.data[word_index];
    while (word != 0U) {
      if (out_index >= out_values.length) {
        return ThrowError(env, "Perfect prototype bitset/bitset fill output buffer too small");
      }
      const uint32_t bit_index = TrailingZeroCount32(word);
      out_values.data[out_index] = static_cast<uint32_t>(word_index * 32U + bit_index);
      out_index += 1U;
      word &= word - 1U;
    }
  }
  return CreateUint32Result(env, static_cast<uint32_t>(out_index));
}

inline napi_value NativeSparseSparseEquals(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 2, &argc, &argv)) return nullptr;
  Uint32View left;
  Uint32View right;
  if (argc < 2 || !GetUint32ArrayView(env, argv[0], "leftValues", &left) ||
      !GetUint32ArrayView(env, argv[1], "rightValues", &right)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  const bool equal =
      left.length == right.length &&
      (left.length == 0U || std::memcmp(left.data, right.data, left.length * sizeof(uint32_t)) == 0);
  napi_value result;
  napi_get_boolean(env, equal, &result);
  return result;
}

inline napi_value NativeBitmapEquals(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 2, &argc, &argv)) return nullptr;
  Uint32View left_words;
  Uint32View right_words;
  if (argc < 2 || !GetUint32ArrayView(env, argv[0], "leftWords", &left_words) ||
      !GetUint32ArrayView(env, argv[1], "rightWords", &right_words)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  const bool equal = BitmapWordsEqualAvx2(
      left_words.data,
      left_words.length,
      right_words.data,
      right_words.length);
  napi_value result;
  napi_get_boolean(env, equal, &result);
  return result;
}

inline napi_value NativeSparseSparseSubset(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 2, &argc, &argv)) return nullptr;
  Uint32View subset;
  Uint32View superset;
  if (argc < 2 || !GetUint32ArrayView(env, argv[0], "subsetValues", &subset) ||
      !GetUint32ArrayView(env, argv[1], "supersetValues", &superset)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  const bool is_subset = SparseSparseSubsetAdaptiveExactV4(
      subset.data,
      subset.length,
      superset.data,
      superset.length);
  napi_value result;
  napi_get_boolean(env, is_subset, &result);
  return result;
}

inline napi_value NativeSparseBitmapSubset(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 2, &argc, &argv)) return nullptr;
  Uint32View subset_values;
  Uint32View superset_words;
  if (argc < 2 || !GetUint32ArrayView(env, argv[0], "subsetValues", &subset_values) ||
      !GetUint32ArrayView(env, argv[1], "supersetWords", &superset_words)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  const bool is_subset = SparseBitmapSubsetExactV4(subset_values, superset_words);
  napi_value result;
  napi_get_boolean(env, is_subset, &result);
  return result;
}

inline napi_value NativeBitmapSubset(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 2, &argc, &argv)) return nullptr;
  Uint32View subset_words;
  Uint32View superset_words;
  if (argc < 2 || !GetUint32ArrayView(env, argv[0], "subsetWords", &subset_words) ||
      !GetUint32ArrayView(env, argv[1], "supersetWords", &superset_words)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  const bool is_subset = BitmapWordsSubsetAvx2(
      subset_words.data,
      subset_words.length,
      superset_words.data,
      superset_words.length);
  napi_value result;
  napi_get_boolean(env, is_subset, &result);
  return result;
}

inline napi_value NativeDecodeDeltaToArray(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 2, &argc, &argv)) return nullptr;
  const uint8_t* bytes = nullptr;
  size_t length = 0;
  uint32_t expected_count = 0;
  bool count_present = false;
  if (argc < 1 || !GetBufferView(env, argv[0], "buffer", &bytes, &length)) {
    delete[] argv;
    return nullptr;
  }
  if (argc >= 2 && !GetOptionalUint32(env, argv[1], &expected_count, &count_present)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  std::vector<uint32_t> out;
  if (!DecodeDeltaVarints(env, bytes, length, count_present, expected_count, &out)) {
    return nullptr;
  }
  return CreateUint32ArrayCopy(env, out.data(), out.size());
}

inline napi_value NativeDecodeDeltaToBitmap(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 3, &argc, &argv)) return nullptr;
  const uint8_t* bytes = nullptr;
  size_t length = 0;
  uint32_t expected_count = 0;
  uint32_t universe_size = 0;
  if (argc < 3 || !GetBufferView(env, argv[0], "buffer", &bytes, &length) ||
      !GetRequiredUint32(env, argv[1], "count", &expected_count) ||
      !GetRequiredUint32(env, argv[2], "universeSize", &universe_size)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  if (universe_size < 1U) {
    return ThrowError(env, "Perfect prototype native bitmap decode requires universeSize > 0");
  }
  std::vector<uint32_t> words((static_cast<size_t>(universe_size) + 31U) / 32U, 0U);
  uint64_t previous = 0;
  uint64_t value = 0;
  uint32_t shift = 0;
  uint32_t decoded_count = 0;
  for (size_t index = 0; index < length; index += 1U) {
    const uint8_t byte = bytes[index];
    value |= static_cast<uint64_t>(byte & 0x7fU) << shift;
    if ((byte & 0x80U) == 0U) {
      if (value > std::numeric_limits<uint32_t>::max()) {
        return ThrowError(env, "Perfect prototype native decode exceeded uint32 delta range");
      }
      previous += value;
      if (previous > std::numeric_limits<uint32_t>::max()) {
        return ThrowError(env, "Perfect prototype native decode exceeded uint32 row index range");
      }
      const uint32_t decoded_value = static_cast<uint32_t>(previous);
      if (decoded_value >= universe_size) {
        return ThrowError(env, "Perfect prototype native bitmap decode exceeded universe");
      }
      words[static_cast<size_t>(decoded_value >> 5U)] |= (1U << (decoded_value & 31U));
      decoded_count += 1U;
      value = 0;
      shift = 0;
      if (expected_count > 0U && decoded_count >= expected_count) {
        break;
      }
      continue;
    }
    shift += 7U;
    if (shift > 35U) {
      return ThrowError(env, "Perfect prototype native decode encountered malformed varint");
    }
  }
  if (shift != 0U || value != 0U) {
    return ThrowError(env, "Perfect prototype native decode encountered unterminated varint");
  }
  if (decoded_count != expected_count) {
    return ThrowError(env, "Perfect prototype native bitmap decode count mismatch");
  }
  return CreateBitmapResult(env, words, decoded_count, universe_size);
}

inline napi_value NativeMergeShiftedDeltaRefs(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 3, &argc, &argv)) return nullptr;
  uint32_t ref_count = 0;
  Uint32View row_offsets;
  Uint32View counts;
  if (argc < 3 ||
      !GetArrayLength(env, argv[0], "buffers", &ref_count) ||
      !GetUint32ArrayView(env, argv[1], "rowOffsets", &row_offsets) ||
      !GetUint32ArrayView(env, argv[2], "counts", &counts)) {
    delete[] argv;
    return nullptr;
  }
  if (row_offsets.length != static_cast<size_t>(ref_count) || counts.length != static_cast<size_t>(ref_count)) {
    delete[] argv;
    return ThrowError(env, "Perfect prototype shifted-delta merge input length mismatch");
  }
  napi_value buffers_value = argv[0];
  delete[] argv;

  std::vector<uint8_t> merged_bytes;
  uint32_t total_count = 0U;
  uint32_t first_row_idx = 0U;
  uint32_t last_row_idx = 0U;
  bool has_values = false;
  for (uint32_t ref_index = 0U; ref_index < ref_count; ref_index += 1U) {
    napi_value buffer_value;
    if (napi_get_element(env, buffers_value, ref_index, &buffer_value) != napi_ok) {
      return ThrowError(env, "Failed to read shifted-delta merge buffer element");
    }
    const uint8_t* bytes = nullptr;
    size_t length = 0;
    if (!GetBufferView(env, buffer_value, "buffer", &bytes, &length)) {
      return nullptr;
    }
    const uint32_t row_offset = row_offsets.data[ref_index];
    const uint32_t expected_count = counts.data[ref_index];
    if (!MergeShiftedDeltaSegment(
            env,
            bytes,
            length,
            row_offset,
            expected_count,
            &merged_bytes,
            &total_count,
            &has_values,
            &first_row_idx,
            &last_row_idx)) {
      return nullptr;
    }
  }
  return CreateShiftedDeltaMergeResult(env, merged_bytes, total_count, has_values, first_row_idx, last_row_idx);
}

inline napi_value NativeMergeShiftedDeltaRefsFromFiles(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 5, &argc, &argv)) return nullptr;
  Int32View file_descriptors;
  BigUint64View offsets;
  Uint32View byte_lengths;
  Uint32View row_offsets;
  Uint32View counts;
  if (argc < 5 ||
      !GetInt32ArrayView(env, argv[0], "fileDescriptors", &file_descriptors) ||
      !GetBigUint64ArrayView(env, argv[1], "offsets", &offsets) ||
      !GetUint32ArrayView(env, argv[2], "byteLengths", &byte_lengths) ||
      !GetUint32ArrayView(env, argv[3], "rowOffsets", &row_offsets) ||
      !GetUint32ArrayView(env, argv[4], "counts", &counts)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  const size_t ref_count = file_descriptors.length;
  if (offsets.length != ref_count ||
      byte_lengths.length != ref_count ||
      row_offsets.length != ref_count ||
      counts.length != ref_count) {
    return ThrowError(env, "Perfect prototype shifted-delta file merge input length mismatch");
  }

  std::vector<uint8_t> merged_bytes;
  std::vector<uint8_t> scratch;
  uint32_t total_count = 0U;
  uint32_t first_row_idx = 0U;
  uint32_t last_row_idx = 0U;
  bool has_values = false;
  for (size_t ref_index = 0; ref_index < ref_count; ref_index += 1U) {
    if (!ReadExactFdRange(
            env,
            file_descriptors.data[ref_index],
            offsets.data[ref_index],
            byte_lengths.data[ref_index],
            &scratch)) {
      return nullptr;
    }
    if (!MergeShiftedDeltaSegment(
            env,
            scratch.data(),
            scratch.size(),
            row_offsets.data[ref_index],
            counts.data[ref_index],
            &merged_bytes,
            &total_count,
            &has_values,
            &first_row_idx,
            &last_row_idx)) {
      return nullptr;
    }
  }
  return CreateShiftedDeltaMergeResult(env, merged_bytes, total_count, has_values, first_row_idx, last_row_idx);
}

inline napi_value NativeSpliceShiftedDeltaRefsToFile(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value* argv = nullptr;
  if (!GetCallbackArgs(env, info, 9, &argc, &argv)) return nullptr;
  int32_t output_fd = -1;
  uint64_t output_offset = 0U;
  Int32View input_fds;
  BigUint64View offsets;
  Uint32View byte_lengths;
  Uint32View row_offsets;
  Uint32View counts;
  Int32View first_row_idxs;
  Int32View last_row_idxs;
  if (argc < 9 ||
      !GetRequiredInt32(env, argv[0], "outputFd", &output_fd) ||
      !GetRequiredUint64BigInt(env, argv[1], "outputOffset", &output_offset) ||
      !GetInt32ArrayView(env, argv[2], "inputFileDescriptors", &input_fds) ||
      !GetBigUint64ArrayView(env, argv[3], "offsets", &offsets) ||
      !GetUint32ArrayView(env, argv[4], "byteLengths", &byte_lengths) ||
      !GetUint32ArrayView(env, argv[5], "rowOffsets", &row_offsets) ||
      !GetUint32ArrayView(env, argv[6], "counts", &counts) ||
      !GetInt32ArrayView(env, argv[7], "firstRowIdxs", &first_row_idxs) ||
      !GetInt32ArrayView(env, argv[8], "lastRowIdxs", &last_row_idxs)) {
    delete[] argv;
    return nullptr;
  }
  delete[] argv;
  if (output_fd < 0) {
    return ThrowError(env, "Perfect prototype postings splice requires a non-negative output file descriptor");
  }
  const size_t ref_count = input_fds.length;
  if (offsets.length != ref_count ||
      byte_lengths.length != ref_count ||
      row_offsets.length != ref_count ||
      counts.length != ref_count ||
      first_row_idxs.length != ref_count ||
      last_row_idxs.length != ref_count) {
    return ThrowError(env, "Perfect prototype postings splice input length mismatch");
  }

  uint64_t cursor = output_offset;
  uint32_t total_count = 0U;
  uint32_t first_row_idx = 0U;
  uint32_t last_row_idx = 0U;
  bool has_values = false;

  for (size_t ref_index = 0; ref_index < ref_count; ref_index += 1U) {
    const uint32_t count = counts.data[ref_index];
    const uint32_t byte_length = byte_lengths.data[ref_index];
    const int32_t raw_first_row_idx = first_row_idxs.data[ref_index];
    const int32_t raw_last_row_idx = last_row_idxs.data[ref_index];
    if (count == 0U) {
      if (byte_length != 0U) {
        return ThrowError(env, "Perfect prototype postings splice encountered non-empty bytes for zero-count ref");
      }
      continue;
    }
    if (byte_length < 1U) {
      return ThrowError(env, "Perfect prototype postings splice requires non-zero byte length for non-empty ref");
    }
    if (raw_first_row_idx < 0 || raw_last_row_idx < 0) {
      return ThrowError(env, "Perfect prototype postings splice requires non-null first/last row metadata");
    }
    const uint32_t local_first_row_idx = static_cast<uint32_t>(raw_first_row_idx);
    const uint32_t local_last_row_idx = static_cast<uint32_t>(raw_last_row_idx);
    if (local_last_row_idx < local_first_row_idx) {
      return ThrowError(env, "Perfect prototype postings splice encountered inverted first/last row metadata");
    }
    const uint64_t shifted_first64 = static_cast<uint64_t>(local_first_row_idx) + static_cast<uint64_t>(row_offsets.data[ref_index]);
    const uint64_t shifted_last64 = static_cast<uint64_t>(local_last_row_idx) + static_cast<uint64_t>(row_offsets.data[ref_index]);
    if (shifted_first64 > std::numeric_limits<uint32_t>::max() ||
        shifted_last64 > std::numeric_limits<uint32_t>::max()) {
      return ThrowError(env, "Perfect prototype postings splice exceeded uint32 shifted row index range");
    }
    const uint32_t shifted_first = static_cast<uint32_t>(shifted_first64);
    const uint32_t shifted_last = static_cast<uint32_t>(shifted_last64);
    if (has_values && shifted_first <= last_row_idx) {
      return ThrowError(env, "Perfect prototype postings splice encountered non-monotonic shifted row indexes");
    }

    uint32_t decoded_first_delta = 0U;
    uint32_t consumed_bytes = 0U;
    if (!ReadFirstDeltaVarintFromFd(
            env,
            input_fds.data[ref_index],
            offsets.data[ref_index],
            byte_length,
            &decoded_first_delta,
            &consumed_bytes)) {
      return nullptr;
    }
    if (decoded_first_delta != local_first_row_idx) {
      return ThrowError(env, "Perfect prototype postings splice first-row metadata mismatch");
    }
    if (count == 1U && consumed_bytes != byte_length) {
      return ThrowError(env, "Perfect prototype postings splice encountered unexpected tail bytes for single-row ref");
    }
    if (count > 1U && consumed_bytes >= byte_length) {
      return ThrowError(env, "Perfect prototype postings splice missing tail bytes for multi-row ref");
    }

    std::vector<uint8_t> bridge_bytes;
    bridge_bytes.reserve(5U);
    const uint32_t bridge_delta = has_values ? (shifted_first - last_row_idx) : shifted_first;
    EncodeDeltaVarint(bridge_delta, &bridge_bytes);
    if (!WriteExactFdRange(env, output_fd, cursor, bridge_bytes.data(), bridge_bytes.size())) {
      return nullptr;
    }
    cursor += static_cast<uint64_t>(bridge_bytes.size());
    if (byte_length > consumed_bytes) {
      if (!CopyFdRange(
              env,
              input_fds.data[ref_index],
              offsets.data[ref_index] + static_cast<uint64_t>(consumed_bytes),
              byte_length - consumed_bytes,
              output_fd,
              cursor)) {
        return nullptr;
      }
      cursor += static_cast<uint64_t>(byte_length - consumed_bytes);
    }

    if (!has_values) {
      first_row_idx = shifted_first;
      has_values = true;
    }
    last_row_idx = shifted_last;
    if (total_count > std::numeric_limits<uint32_t>::max() - count) {
      return ThrowError(env, "Perfect prototype postings splice count exceeded uint32 range");
    }
    total_count += count;
  }

  napi_value result;
  if (napi_create_object(env, &result) != napi_ok) {
    return ThrowError(env, "Failed to create postings splice result");
  }
  if (!SetNamedUint32(env, result, "count", total_count)) {
    return nullptr;
  }
  const uint64_t merged_byte_length = cursor - output_offset;
  if (merged_byte_length > std::numeric_limits<uint32_t>::max()) {
    return ThrowError(env, "Perfect prototype postings splice byte length exceeded uint32 range");
  }
  if (!SetNamedUint32(env, result, "byteLength", static_cast<uint32_t>(merged_byte_length))) {
    return nullptr;
  }
  napi_value first_value;
  napi_value last_value;
  if (has_values) {
    if (napi_create_uint32(env, first_row_idx, &first_value) != napi_ok ||
        napi_create_uint32(env, last_row_idx, &last_value) != napi_ok) {
      return ThrowError(env, "Failed to create postings splice range values");
    }
  } else {
    if (napi_get_null(env, &first_value) != napi_ok || napi_get_null(env, &last_value) != napi_ok) {
      return ThrowError(env, "Failed to create postings splice null range values");
    }
  }
  if (napi_set_named_property(env, result, "firstRowIdx", first_value) != napi_ok ||
      napi_set_named_property(env, result, "lastRowIdx", last_value) != napi_ok) {
    return ThrowError(env, "Failed to set postings splice range values");
  }
  return result;
}

inline napi_value NativeGetBuildInfo(napi_env env, napi_callback_info info) {
  napi_value result;
  if (napi_create_object(env, &result) != napi_ok) {
    return ThrowError(env, "Failed to create build info object");
  }
#if defined(__linux__)
  constexpr const char* platform = "linux";
#elif defined(__APPLE__)
  constexpr const char* platform = "darwin";
#elif defined(_WIN32)
  constexpr const char* platform = "win32";
#else
  constexpr const char* platform = "unknown";
#endif
#if defined(__x86_64__) || defined(_M_X64)
  constexpr const char* arch = "x64";
#elif defined(__aarch64__) || defined(_M_ARM64)
  constexpr const char* arch = "arm64";
#else
  constexpr const char* arch = "unknown";
#endif
  napi_value platform_value;
  napi_value arch_value;
  napi_value napi_version_value;
  napi_value kernel_mode_value;
  napi_value sparse_kernel_mode_value;
  napi_value simd_required_value;
  napi_value vector_width_bits_value;
  napi_value required_cpu_features_value;
  napi_create_string_utf8(env, platform, NAPI_AUTO_LENGTH, &platform_value);
  napi_create_string_utf8(env, arch, NAPI_AUTO_LENGTH, &arch_value);
  napi_create_uint32(env, NAPI_VERSION, &napi_version_value);
  napi_create_string_utf8(env, PERFECT_PROTO_SIMD_KERNEL_MODE, NAPI_AUTO_LENGTH, &kernel_mode_value);
  napi_create_string_utf8(env, kPerfectProtoSparseKernelMode, NAPI_AUTO_LENGTH, &sparse_kernel_mode_value);
  napi_get_boolean(env, true, &simd_required_value);
  napi_create_uint32(env, 256U, &vector_width_bits_value);
  napi_create_array_with_length(env, 2U, &required_cpu_features_value);
  napi_value required_feature_value;
  napi_create_string_utf8(env, "avx2", NAPI_AUTO_LENGTH, &required_feature_value);
  napi_set_element(env, required_cpu_features_value, 0U, required_feature_value);
  napi_create_string_utf8(env, "popcnt", NAPI_AUTO_LENGTH, &required_feature_value);
  napi_set_element(env, required_cpu_features_value, 1U, required_feature_value);
  napi_set_named_property(env, result, "platform", platform_value);
  napi_set_named_property(env, result, "arch", arch_value);
  napi_set_named_property(env, result, "napiVersion", napi_version_value);
  napi_set_named_property(env, result, "kernelMode", kernel_mode_value);
  napi_set_named_property(env, result, "sparseKernelMode", sparse_kernel_mode_value);
  napi_set_named_property(env, result, "simdRequired", simd_required_value);
  napi_set_named_property(env, result, "vectorWidthBits", vector_width_bits_value);
  napi_set_named_property(env, result, "requiredCpuFeatures", required_cpu_features_value);
  return result;
}

inline napi_value NativeGetRuntimeStats(napi_env env, napi_callback_info info) {
  napi_value result;
  if (napi_create_object(env, &result) != napi_ok) {
    return ThrowError(env, "Failed to create runtime stats object");
  }
  if (!SetNamedDouble(env, result, "sparseEqualSizeMergeCount", static_cast<double>(gSparseEqualSizeMergeCount)) ||
      !SetNamedDouble(env, result, "sparseAdaptiveGallopCount", static_cast<double>(gSparseAdaptiveGallopCount)) ||
      !SetNamedDouble(env, result, "sparseCountFastPathCount", static_cast<double>(gSparseCountFastPathCount)) ||
      !SetNamedDouble(env, result, "sparseBitmapWordRunCount", static_cast<double>(gSparseBitmapWordRunCount)) ||
      !SetNamedDouble(env, result, "sparseBitmapSkippedRunCount", static_cast<double>(gSparseBitmapSkippedRunCount)) ||
      !SetNamedDouble(env, result, "sparseBitmapPartialRunCount", static_cast<double>(gSparseBitmapPartialRunCount)) ||
      !SetNamedDouble(env, result, "sparseBitmapFullRunHitCount", static_cast<double>(gSparseBitmapFullRunHitCount))) {
    return nullptr;
  }
  return result;
}

inline napi_value NativeResetRuntimeStats(napi_env env, napi_callback_info info) {
  gSparseEqualSizeMergeCount = 0U;
  gSparseAdaptiveGallopCount = 0U;
  gSparseCountFastPathCount = 0U;
  gSparseBitmapWordRunCount = 0U;
  gSparseBitmapSkippedRunCount = 0U;
  gSparseBitmapPartialRunCount = 0U;
  gSparseBitmapFullRunHitCount = 0U;
  napi_value result;
  if (napi_get_undefined(env, &result) != napi_ok) {
    return ThrowError(env, "Failed to create runtime stats reset result");
  }
  return result;
}

}  // namespace

NAPI_MODULE_INIT() {
  napi_property_descriptor descriptors[] = {
      {"bitmapBitmapIntersectionCount", nullptr, NativeBitmapBitmapIntersectionCount, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"bitmapBitmapIntersectionCountBatch", nullptr, NativeBitmapBitmapIntersectionCountBatch, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"bitmapBitmapIntersectionValuesFill", nullptr, NativeBitmapBitmapIntersectionValuesFill, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"bitmapBitmapIntersectionValues", nullptr, NativeBitmapBitmapIntersectionValues, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"bitmapBitmapIntersectionWordsFill", nullptr, NativeBitmapBitmapIntersectionWordsFill, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"bitmapBitmapIntersectionWords", nullptr, NativeBitmapBitmapIntersectionWords, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"bitmapEdgeSummary", nullptr, NativeBitmapEdgeSummary, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"bitmapEquals", nullptr, NativeBitmapEquals, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"bitmapMaterializeValues", nullptr, NativeBitmapMaterializeValues, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"bitmapSubset", nullptr, NativeBitmapSubset, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"decodeDeltaToArray", nullptr, NativeDecodeDeltaToArray, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"decodeDeltaToBitmap", nullptr, NativeDecodeDeltaToBitmap, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getBuildInfo", nullptr, NativeGetBuildInfo, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getRuntimeStats", nullptr, NativeGetRuntimeStats, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"mergeShiftedDeltaRefs", nullptr, NativeMergeShiftedDeltaRefs, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"mergeShiftedDeltaRefsFromFiles", nullptr, NativeMergeShiftedDeltaRefsFromFiles, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"resetRuntimeStats", nullptr, NativeResetRuntimeStats, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"spliceShiftedDeltaRefsToFile", nullptr, NativeSpliceShiftedDeltaRefsToFile, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"sparseBitmapIntersectionCount", nullptr, NativeSparseBitmapIntersectionCount, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"bitmapSparseIntersectionCountBatch", nullptr, NativeBitmapSparseIntersectionCountBatch, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"sparseBitmapIntersectionCountBatch", nullptr, NativeSparseBitmapIntersectionCountBatch, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"sparseBitmapIntersectionValuesFill", nullptr, NativeSparseBitmapIntersectionValuesFill, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"sparseBitmapIntersectionValues", nullptr, NativeSparseBitmapIntersectionValues, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"sparseBitmapIntersectionWordsFill", nullptr, NativeSparseBitmapIntersectionWordsFill, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"sparseBitmapIntersectionWords", nullptr, NativeSparseBitmapIntersectionWords, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"sparseBitmapSubset", nullptr, NativeSparseBitmapSubset, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"sparseSparseEquals", nullptr, NativeSparseSparseEquals, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"sparseSparseIntersectionCount", nullptr, NativeSparseSparseIntersectionCount, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"sparseSparseIntersectionCountBatch", nullptr, NativeSparseSparseIntersectionCountBatch, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"sparseSparseIntersectionFill", nullptr, NativeSparseSparseIntersectionFill, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"sparseSparseIntersectionValues", nullptr, NativeSparseSparseIntersectionValues, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"sparseSparseSubset", nullptr, NativeSparseSparseSubset, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  if (napi_define_properties(env, exports, sizeof(descriptors) / sizeof(descriptors[0]), descriptors) != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to define native rowset kernel exports");
    return nullptr;
  }
  return exports;
}
