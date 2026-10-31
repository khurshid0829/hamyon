# Hamyon

Oilaviy byudjet (PWA): soʻm va dollarda tez kiritish, tushunarli tahlil. Bir telefon uchun; maʼlumotlar faqat qurilmaning oʻzida (localStorage) saqlanadi, server yoʻq.

## Ishga tushirish

```
node serve.js                       # http://localhost:5182
node --test tests/engine.test.js    # dvigatel testlari
```

## Asosiy imkoniyatlar

| Boʻlim | Nima qiladi |
|---|---|
| Tez kiritish | Summa → turkum → saqlash (3 bosish), “000” tugmasi, soʻm ⇄ $, oxirgi ishlatilgan hisob |
| Matn | `non 8 ming, sut 14 000, taksi 25k, kitob $15` — bir yoʻla bir nechta yozuv, turkum soʻzdan aniqlanadi (kirillda ham) |
| SMS | Karta SMS yoki bildirishnomasidan summa, doʻkon, karta (*4417) va qoldiq; qoldiq ilovadagi bilan solishtiriladi |
| Chek | iPhone kamerasining matn tanish funksiyasi bilan nusxalangan chekdan jami summa (“Jami”, “Итого”) va doʻkon nomi |
| Tahlil | Turkumlar, oʻtgan oyning shu kunlari bilan solishtirish, dollarda oʻlchash, 6 oy, oddiy tildagi xulosalar |
| Rejalar | Oylik reja, “kuniga qancha”, turkum limitlari, doimiy toʻlovlar, qarzlar, jamgʻarma maqsadlari |
| Hisoblar | Naqd, kartalar, dollar; oʻtkazma va valyuta almashtirish; Markaziy bank kursi (cbu.uz) yoki bozor kursi |
| Yozuv | Lotin, Lotin 2026 (OʻRQ-1184: Ö, Ğ, Ş, Ç), Кирилл |

## Aniqlik

- Pul butun son: soʻm butun, dollar sentda. Yaxlitlash xatosi yigʻilmaydi.
- Har bir yozuv yaratilgan kungi kursni saqlaydi (`rate`, `uzs`), shuning uchun kurs oʻzgarsa ham eski hisoblar oʻzgarmaydi.
- Oʻtkazmalar xarajat yoki daromad hisoblanmaydi.

## Fayllar

| Fayl | Vazifasi |
|---|---|
| `engine.js` | Sof funksiyalar: pul, matn/SMS tahlili, statistika, alifbo oʻgirish |
| `data.js` | Turkumlar (kalit soʻzlar bilan) va ikonlar |
| `app.js` | Ekranlar va saqlash |
| `sw.js` | Offline kesh (fayl oʻzgarsa `VERSION` ni oshiring) |

## Cheklovlar

- Veb-ilova SMS'ni oʻzi oʻqiy olmaydi: matnni nusxalab qoʻyish kerak.
- Bitta telefon: boshqa telefon bilan sinxronlash yoʻq. Zaxira uchun Sozlamalar → “Nusxa olish”.
- Yangi alifboning batafsil imlo qoidalari eʼlon qilingach, oʻgirish qoidalari yangilanadi.
