/* Copyright (c) 2019 The Brave Authors. All rights reserved.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef BRAVELEDGER_MEDIA_YOUTUBE_H_
#define BRAVELEDGER_MEDIA_YOUTUBE_H_

#include "bat/ledger/ledger.h"

namespace bat_ledger {
class LedgerImpl;
}

namespace braveledger_media {

class MediaYouTube : public ledger::LedgerCallbackHandler {
 public:
  explicit MediaYouTube(bat_ledger::LedgerImpl* ledger);

  ~MediaYouTube() override;

 private:
  bat_ledger::LedgerImpl* ledger_;  // NOT OWNED
};

}  // namespace braveledger_media

#endif  // BRAVELEDGER_MEDIA_YOUTUBE_H_
