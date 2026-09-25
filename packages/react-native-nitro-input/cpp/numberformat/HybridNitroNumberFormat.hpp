//
//  HybridNitroNumberFormat.hpp
//  NitroInput
//
//  `NumberFormat` for JS: the API of `Intl.NumberFormat`, formatted in C++.
//  The factory resolves the options the way ECMA-402 does, learns the
//  locale's format from the platform once (NumberFormatProbe) and hands out
//  shared, immutable formatters. Notations and styles the C++ core does not
//  draw (compact, scientific, engineering, units, currency names) format
//  through the platform formatter instead, still synchronously.
//

#pragma once

#include "HybridNitroNumberFormatFactorySpec.hpp"
#include "HybridNitroNumberFormatSpec.hpp"
#include "HybridNitroPlatformNumberFormatterSpec.hpp"
#include "NumberFormatCore.hpp"
#include "NumberFormatProbe.hpp"

#include <memory>
#include <optional>

namespace margelo::nitro::nitroinput {

class HybridNitroNumberFormat final : public HybridNitroNumberFormatSpec {
public:
  /// A formatter the C++ core draws.
  HybridNitroNumberFormat(ResolvedNumberFormatOptions resolved, numberformat::NumberFormatCore core);
  /// A formatter the platform draws; `format` and `symbols` read its output back into parts.
  HybridNitroNumberFormat(ResolvedNumberFormatOptions resolved, std::shared_ptr<HybridNitroPlatformNumberFormatterSpec> platform,
                          numberformat::LocaleFormat format, numberformat::ProbeSymbols symbols, numberformat::TextKind words, bool scientific);

  std::string format(const std::variant<int64_t, double, std::string>& value) override;
  std::vector<NumberFormatPart> formatToParts(const std::variant<int64_t, double, std::string>& value) override;
  ResolvedNumberFormatOptions resolvedOptions() override { return resolved_; }

  /// The C++ core, or null for a formatter the platform draws.
  const numberformat::NumberFormatCore* core() const { return core_ ? &*core_ : nullptr; }

  size_t getExternalMemorySize() noexcept override { return 2048; }

private:
  std::string formatWithPlatform(const std::variant<int64_t, double, std::string>& value);

  ResolvedNumberFormatOptions resolved_;
  std::optional<numberformat::NumberFormatCore> core_;
  std::shared_ptr<HybridNitroPlatformNumberFormatterSpec> platform_;
  numberformat::LocaleFormat platformFormat_;
  numberformat::ProbeSymbols platformSymbols_;
  numberformat::TextKind words_ = numberformat::TextKind::Literal;
  bool scientific_ = false;
};

class HybridNitroNumberFormatFactory final : public HybridNitroNumberFormatFactorySpec {
public:
  HybridNitroNumberFormatFactory() : HybridObject(TAG) {}

  std::shared_ptr<HybridNitroNumberFormatSpec> create(const std::vector<std::string>& locales, const NumberFormatOptions& options) override;
  std::vector<std::string> supportedLocalesOf(const std::vector<std::string>& locales) override;
};

} // namespace margelo::nitro::nitroinput
