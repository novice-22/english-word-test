# 제3자 구성요소 고지

이 저장소는 MIT 라이선스([LICENSE](LICENSE))로 배포되지만, 아래 구성요소는 별도의
저작권자와 라이선스를 가집니다. 소스·바이너리 어느 형태로 재배포하든
해당 고지문을 함께 실어야 합니다.

---

## CMU Pronouncing Dictionary

**쓰이는 곳**: `server/phonetics.json.gz`
— CMUdict 의 ARPAbet 발음 표기를 IPA 로 변환해 담은 파생 저작물입니다.
변환 코드는 `tools/build-phonetics.mjs` 입니다.

**원본**: <https://github.com/cmusphinx/cmudict>
**라이선스**: BSD 2-Clause

```
Copyright (C) 1993-2015 Carnegie Mellon University. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
   The contents of this file are deemed to be source code.

2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in
   the documentation and/or other materials provided with the
   distribution.

This work was supported in part by funding from the Defense Advanced
Research Projects Agency, the Office of Naval Research and the National
Science Foundation of the United States of America, and by member
companies of the Carnegie Mellon Sphinx Speech Consortium. We acknowledge
the contributions of many volunteers to the expansion and improvement of
this dictionary.

THIS SOFTWARE IS PROVIDED BY CARNEGIE MELLON UNIVERSITY ``AS IS'' AND
ANY EXPRESSED OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL CARNEGIE MELLON UNIVERSITY
NOR ITS EMPLOYEES BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

> 도커 이미지에도 `server/phonetics.json.gz` 가 들어갑니다(`COPY server/`).
> 이미지를 배포한다면 이 파일도 함께 가야 clause 2 를 만족합니다.

---

## 폰트 (CDN 으로 불러쓰기만 함 — 저장소에 담지 않음)

| 폰트 | 라이선스 | 출처 |
| --- | --- | --- |
| Pretendard | SIL Open Font License 1.1 | <https://github.com/orioncactus/pretendard> |
| JetBrains Mono | SIL Open Font License 1.1 | <https://github.com/JetBrains/JetBrainsMono> |

`client/index.html` 이 `cdn.jsdelivr.net` 에서 스타일시트로 불러옵니다.
파일을 재배포하지 않으므로 OFL 의 번들 조건은 적용되지 않습니다.
