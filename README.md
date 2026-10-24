# Flipfight

Pixel art NFT kart düellosu. Oyuncular herhangi bir EVM cüzdanıyla (MetaMask, Rabby, Coinbase Wallet, Trust, OKX, Phantom…) giriş yapar, takma ad seçer ve gerçek rakiplerle canlı eşleşir. Tüm tokenlar ve kartlar **demo** varlıklardır ve sunucunun veritabanında tutulur; zincire hiçbir işlem gönderilmez.

## Neler var

- **Cüzdanla giriş (tüm EVM cüzdanları):** Oyuncu ücretsiz bir mesaj imzalar (işlem değil, gas yok). Sunucu imzayı doğrular ve 30 günlük oturum açar.
- **Takma ad:** İlk girişte seçilir, benzersizdir ve değiştirilemez. Lider tablosunda bu görünür.
- **Başlangıç paketi:** Her yeni oyuncuya 200.000 FLIP, 12 başlangıç kartı ve 2 ücretsiz paket.
- **Gerçek zamanlı PvP:** Oda kuyrukları, sunucu tarafında oynanan maçlar, 20 saniyelik tur süresi (süre dolarsa rastgele kart oynanır), sayfa yenilense bile maça geri dönme.
- **Sunucu otoritesi:** Bakiye, kart sahipliği, paket açma (kriptografik rastgelelik), deste kuralları ve maç sonucu tamamen sunucuda hesaplanır. Tarayıcı sadece seçim gönderir.
- **Ekonomi:** Giriş tutarı maç başında kilitlenir, kazanan havuzu alır. %5 komisyonun %40'ı yakılır, %40'ı hazineye, %20'si sezon havuzuna gider. Paket fiyatının yarısı yakılır.
- **Haftalık sezonlar:** Her sezon 7 gün sürer; ELO sezon puanıdır (K=32). Ödül için sezonda en az 3 dereceli maç gerekir. Sezon bitince sunucu otomatik olarak ilk 100'e öder: 1. 1.000.000, 2. 500.000, 3. 250.000, 4-100. sıra `800.000 ÷ sıra` (1.000'e aşağı yuvarlanır; toplam 4.393.000 FLIP). İlk 3 kalıcı rozet alır. Ardından puanlar 1200'e doğru yarı yarıya çekilir ve sezon istatistikleri sıfırlanır. Sunucu uyuyup sezon bitişini kaçırırsa uyanınca telafi eder; her sezon tek bir kilitli işlemde kapanır.
- **Rütbeler:** Bronze, Silver (1150), Gold (1300), Platinum (1450), Diamond (1600), Master (1800) piksel rozetleri; üst barda, maçta ve sıralamada görünür.
- **Lider tablosu ve geçmiş:** Sezon sıralaması, kendi sıran (ilk 100 dışında olsan bile), öngörülen ödül, geri sayım, geçen sezonun şampiyonları, son 20 maç.
- **Günlük bonus:** 24 saatte bir 25.000 FLIP.
- **Market (gerçek zamanlı pazar yeri):** Oyuncular kartlarını FLIP karşılığı listeler; yeni ilanlar, satışlar ve iptaller Socket.io ile herkese anında yansır, satıcıya satış bildirimi gider. Alıcı fiyatı öder, satıcı %5 komisyon düşülmüş tutarı alır (yarısı yakılır, yarısı hazineye). Satın alma tek bir atomik işlemle yapılır; aynı kartı iki kişi aynı anda alamaz. Listelenen kart destede ve Forge'da kullanılamaz; oyuncu en az 5 listelenmemiş kartla kalır, en fazla 20 ilan açabilir.
- **Forge (kart birleştirme):** Aynı nadirlikte 2-4 kart birleştirilir. Başarı şansı `1 − (1 − taban)^(kart − 1)`; tabanlar common→rare %40, rare→epic %25, epic→legendary %12. Başarıda bir üst nadirlikte rastgele kart, başarısızlıkta aynı nadirlikte rastgele bir kart geri gelir; kullanılan kartlar her durumda harcanır ve ücret (5.000 / 20.000 / 60.000 FLIP) yakılır. Oyuncu en az 5 kartla kalır. Oranlar ve beklenen maliyetler: `node scripts/fusion-sim.js`.
- **Bota karşı antrenman:** Ücretsiz, her zaman açık; FLIP, ELO ve maç geçmişini etkilemez. Easy, Normal ve Hard seviyeleri var; bot senin destenin aynısıyla oynar (ayna maç), sonucu sadece hamleler belirler.

## Ada (ana ekran)

Girişten sonra oyuncular ortak bir piksel adada başlar (`public/island.js`, `server/island.js`).
- Her oyuncunun cüzdan adresinden üretilen kendine özel bir karakteri vardır. Dokunulan yere engellerin etrafından dolaşarak yürür (karo haritası üzerinde yol bulma); bilgisayarda ok tuşları ve WASD da çalışır.
- Binalar: Arena, Ranks, Shop, Market, Forge, Cards (koleksiyon), History. Kapısına yürünen ya da dokunulan bina ilgili bölümü açar; dönünce oyuncu o binanın önünde belirir. MENU düğmesi binalara kısayol verir.
- Adadaki herkes gerçek zamanlı görünür (saniyede 10 güncelleme) ve HI!, GG, WOW gibi tepki baloncukları gönderebilir. Ada konumları sadece görseldir; sunucu sınırlandırır ve hız sınırı uygular.

## Atmosfer

`public/fx.js` tamamen tarayıcıda üretilen müzik, sahne ve savaş efektlerini içerir; ses ya da görsel dosyası yoktur.

- **Müzik:** Web Audio ile çalan üç chiptune parça: lobi (sakin), arena (davullu) ve son tur / maç sayısı (hızlı, gergin). Parçalar ölçü başında geçiş yapar. Forge'da ateş çıtırtısı, Market'te ara sıra para sesi var. MUSIC ve SFX düğmeleri ayrı ayrı açılıp kapanır.
- **Sahneler:** Lobi gece gökyüzü (kayan yıldızlar), Rookie ve antrenman alacakaranlıkta çayır (ateş böcekleri), Veteran yanardağ (kor ve kül), Legend gökyüzü tapınağı (bulutlar, uçan adalar, ışıltılar).
- **Savaş:** Kartlar açıldıktan sonra yaratıklar ortada çarpışır; vuruş anında kısa donma, ekran sarsıntısı ve kazananın element efektleri (ateş kıvılcımı, su damlaları, rüzgâr girdabı, toprak parçaları). Kaybeden piksel piksel dağılır. Element avantajında "SUPER EFFECTIVE!", yorgun kartlarda "EXHAUSTED" yazısı çıkar. Tur başında ROUND / MATCH POINT / FINAL ROUND afişleri.
- **Canlılık:** Kartlardaki yaratıklar nefes alır ve göz kırpar. "Hareketi azalt" ayarı açık cihazlarda animasyonlar kapanır.

## Yerelde çalıştırma

Node.js 18 veya üzeri ve bir Postgres veritabanı gerekir (Neon'un ücretsiz veritabanını yerelde de kullanabilirsin).

```bash
npm install
cp .env.example .env      # DATABASE_URL satırına bağlantı adresini yaz
npm start
```

Tarayıcıda `http://localhost:3000` adresini aç. Tablolar ilk açılışta otomatik oluşturulur.

Otomatik test (sunucu açıkken, iki sahte cüzdanla tam bir maç oynar):

```bash
node scripts/smoke-test.js http://localhost:3000      # iki oyunculu tam maç
node scripts/practice-test.js http://localhost:3000   # bota karşı antrenman
node scripts/bot-sim.js                               # bot seviyelerinin kazanma oranları (sunucu gerekmez)
node scripts/fusion-sim.js                            # birleştirme oranları ve beklenen maliyetler (sunucu gerekmez)
node scripts/fusion-test.js http://localhost:3000     # birleştirme kuralları ve hata durumları
node scripts/market-test.js http://localhost:3000     # pazar yeri: kurallar, canlı olaylar, iki alıcının yarışı
node scripts/elo-test.js http://localhost:3000        # ELO değişimi ve sıralama
node scripts/season-test.js http://localhost:3000 KEY play   # sezon maçları; sonra sezonu bitirip 'check' ile ödülleri doğrula
```

"Coming soon" açıkken test betiklerine önizleme anahtarını ikinci argüman olarak ver.

## Yayına alma: Render (sunucu) + Neon (veritabanı)

İkisinin de ücretsiz planı var ve kredi kartı istemiyor.

**1. Neon'da veritabanı oluştur**
1. neon.com'a GitHub hesabınla kaydol.
2. Yeni bir proje oluştur (bölge olarak Avrupa'yı seçebilirsin, örneğin Frankfurt).
3. Proje panelinde **Connect** düğmesine bas ve `postgresql://...` ile başlayan bağlantı adresini kopyala.

**2. Render'da sunucuyu kur**
1. render.com'a GitHub hesabınla kaydol.
2. **New → Web Service**, `flipfight` deposunu seç.
3. Ayarlar: Language **Node**, Build Command `npm install`, Start Command `npm start`, Instance Type **Free**.
4. **Environment Variables** bölümüne ekle: `DATABASE_URL` = Neon'dan kopyaladığın adres.
5. **Deploy Web Service**. Bitince Render sana `https://flipfight-xxxx.onrender.com` gibi bir adres verir.

**Ücretsiz planın sınırları**
- Render'ın ücretsiz sunucusu 15 dakika kimse bağlanmazsa uykuya geçer. Sonraki ilk ziyaretçi için açılması yaklaşık 1 dakika sürer; oyuncu bağlıyken uyumaz.
- Veriler Neon'da tutulduğu için sunucu uyusa veya yeniden başlasa da kaybolmaz. Sadece o an sürmekte olan maçlar yarıda kalır.
- Oyun büyüdüğünde Render'ın ücretli planına geçmek uyku sorununu çözer, kodda değişiklik gerekmez.

## Giriş: X görevleri (bir kerelik)

Siteye ilk gelen ziyaretçi, cüzdan bağlamadan **önce** bir kez X kullanıcı adını yazar ve 5 görevi yapar: takip et, bildirimleri aç 🔔, gönderiyi beğen, repost et, yanıt yaz. Sonra cüzdanını bağlar ve nickname seçer; görevler giriş anında hesabına kaydedilir ve bir daha sorulmaz. Kurucu hesabı bu adımı atlar.

- `X_HANDLE`: takip edilecek hesap. Varsayılan `flipfight` (x.com/flipfight); kapatmak için `off`.
- `X_TWEET_URL`: beğenilecek / repost edilecek / yanıtlanacak gönderinin linki. Varsayılan: https://x.com/flipfight/status/2113907998691053783 (ör. `https://x.com/flipfight/status/123…`). Boşsa beğeni / repost / yanıt görevleri profili açar ve oyuncudan son gönderiyi kullanmasını ister.
- `X_REPLY_TEXT` (isteğe bağlı): yanıt kutusuna hazır gelen metin. Varsayılan boş; oyuncular yorumunu kendisi yazar.
- Görevler X'in kendi sayfalarında açılır; oyuncu sekmeye geri döndüğünde işaretlenir. X ücretsiz olarak bu eylemleri doğrulatmaz (ücretli X API gerekir), bu yüzden kontrol güvene dayalıdır. Sunucu yine de her görevin işaretlenmesini, geçerli bir kullanıcı adını ve her X hesabının yalnızca bir oyuncuya bağlanmasını zorunlu tutar.

"Coming soon" sayfası artık varsayılan olarak kapalı. Gerekirse `COMING_SOON=on` ile geri açılır (`PREVIEW_KEY` ile önizleme yine çalışır).

## Cüzdanlar ve mobil oyuncular

- **Tarayıcı cüzdanları:** EIP-6963 ile yüklü tüm cüzdanlar listelenir (MetaMask, Rabby, Coinbase Wallet, OKX, Phantom, Brave, Trust eklentisi…). Eski tip cüzdanlar "Browser wallet" olarak çıkar. Son kullanılan cüzdan en üstte durur. Giriş yapılan cüzdanda hesap değişirse oturum kapanır.
- **Cüzdansız telefon:** MetaMask, Trust, Coinbase Wallet, OKX ve Phantom uygulamalarının içindeki tarayıcıda açma bağlantıları gösterilir.
- **WalletConnect (isteğe bağlı):** Telefondaki herhangi bir cüzdanla QR kodla bağlanmak için [cloud.reown.com](https://cloud.reown.com) üzerinden ücretsiz bir proje oluştur, proje ID'sini Render'a `WALLETCONNECT_PROJECT_ID` olarak ekle ve Reown panelinde izinli alan adına `flipfight.fun` yaz. Ayarlanmazsa bu seçenek görünmez.
- Akıllı sözleşme cüzdanları (ör. Coinbase Smart Wallet passkey hesapları, Safe) şu an desteklenmiyor; giriş imzası normal (EOA) hesap ister.

## Proje yapısı

```
server/index.js    HTTP API: giriş, profil, deste, paket, bonus, lider tablosu, geçmiş
server/match.js    Kuyruklar ve maç motoru (Socket.io)
server/db.js       Postgres bağlantısı ve şema
shared/game.js     Kartlar, odalar, paketler, kurallar
public/            Oyun arayüzü (HTML, CSS, JS)
scripts/smoke-test.js  Uçtan uca test
```

## Çift yüzlü kartlar (Flip)

Her kartın bir ön ve bir arka yüzü var. Maçta kartı seçince hangi yüzünün açılacağını da seçersin. Arka yüz biraz daha zayıftır (%93–98 güç) ama başka bir elementi ve bir yeteneği vardır: FLIP TRAP (rakibin kartını ters çevirir, çevrilen kart −8), SHIELD (beraberliği kazanır), ECHO (element bonusu +%60), AMBUSH (daha pahalı karta karşı +20), RALLY (sonraki kartın +10), DRAIN (rakip 2 enerji kaybeder). Denge `scripts/bot-sim.js` ile ayarlandı: iki yüzü de kullanan oyuncu hiç çevirmeyene karşı ~%60 kazanıyor.

## FLIP! çağrısı (pot ikiye katlanır)

2. turdan itibaren, kartını kilitlemeden önce maç başına bir kez "FLIP! ×2" basabilirsin. Rakibin 12 saniyede ya kabul eder (ikiniz de bir giriş daha yatırırsınız, pot ikiye katlanır) ya da çekilir (maçı mevcut bahisten hemen kaybeder). İki oyuncu da birer kez çağırabildiği için pot en fazla ×4 olur. Cevap gelmezse ve parası yetiyorsa kabul sayılır. Antrenmanda bot da FLIP! çağırır ve cevaplar. Test: `node scripts/flip-call-test.js <url> <previewKey>`.

## Klanlar

- Klan kurmak 50.000 FLIP (yakılır), en fazla 25 üye, kurucu liderdir.
- Lider: sancak (renk, sembol, desen) ve katılım modunu (açık / onaylı) düzenler, istekleri onaylar/reddeder, üye atar, liderliği devreder, klanı dağıtır. Lider, başka üye varken liderliği devretmeden ayrılamaz.
- Sancak her üyenin nickinin yanında görünür: adada isim plakasında, maç ekranında, sıralamada ve üst barda.
- Üyelerin her ranked galibiyeti klana 1 sezon puanı verir; sezonun lider klanının sancağı ada meydanındaki direkte dalgalanır. Sezon bitince puanlar sıfırlanır.
- Adada yeni bina: CLANS. Test: `node scripts/clan-test.js <url> <previewKey>`.

## Yaşayan kartlar

Her kart kendi geçmişini tutar: ranked maçlarda oynadığı ve kazandığı tur sayısı ve kaç sahip değiştirdiği (Market satışları). Kartın üstünde "31W/44 · 2 own" gibi görünür. 25 tur galibiyetinde kart evrimleşir (★, parlayan çerçeve), 100 galibiyette efsane görünüme geçer (★★, altın çerçeve ve parıltı). Sadece görünüm değişir, güç aynı kalır. Antrenman maçları sayılmaz.

## Haftalık dünya boss'u

Her sezon (hafta) iskelenin yanında denizden bir boss yükselir (Leviathan, Infernal Wyrm, Stone Colossus, Tempest Roc sırayla). Can barı tüm ada için ortaktır. Herkesin günde 3 ücretsiz dövüş hakkı var (UTC); hasar = 10 × kartlarının toplam gücü + kazanılan tur başına 2.500 + maçı kazanırsan 10.000. Boss hafta bitmeden düşerse vuran herkes 25.000 FLIP, en çok hasar veren ilk 3 ayrıca 100.000 / 50.000 / 25.000 FLIP ve kalıcı ☠ rozeti alır. Boss canı `BOSS_HP` ortam değişkeniyle ayarlanır (varsayılan 250.000). Adada iskelenin ucuna yürü ya da BOSS sekmesini aç. Test: `node scripts/boss-test.js <url> <previewKey>`.

## Ante odası (Oda 4)

FLIP girişi yok. 5 kartını seçtikten sonra birini masaya koyarsın; sadece aynı nadirlikte kart koyan biriyle eşleşirsin. Kazanan, kaybedenin kartını alır (kartın sahip sayısı artar), beraberlikte ikisi de kartını korur. Ranked sayılır (ELO ve klan puanı). FLIP! çağrısı bu odada kapalı. Kuyruktayken veya maçtayken kartlar Market'e konamaz ve Forge'da kullanılamaz. Test: `node scripts/ante-test.js <url> <previewKey>`.

## Kurucu (founder) hesabı

Render → Environment kısmına ekle:

- `FOUNDER_ADDRESSES` = cüzdan adresin (birden fazlaysa virgülle ayır)
- `FOUNDER_NICK` = istediğin nick (isteğe bağlı, 3–16 harf/rakam/alt çizgi)

Kurucu cüzdanı ilk kez nick'iyle bağlandığında (ya da sunucu açılışında) resmi **Flipfight [FF]** klanı ücretsiz kurulur: lideri kurucudur, sadece davetle girilir ve yalnızca bu klana özel, değiştirilemeyen kraliyet sancağını taşır (altın direk ve küre, mor kadife, yakutlu taç, üç uçlu püsküllü etek). Lider, Klan ekranından nick yazarak davet gönderir; davet edilen oyuncuya anında bildirim gider ve Klanlar ekranından kabul eder. Davetle giriş modu diğer klanlara da açık. "FF", "FLIP" gibi etiketler ve içinde "flipfight" geçen klan adları rezervedir.

Bu cüzdan bağlanınca: taçlı, pelerinli kraliyet karakteri, etrafında altın parıltılar, adada kırmızı-altın isim plakası ve her yerde ★ FOUNDER rozeti. `FOUNDER_NICK` girildiyse hesabın nicki girişte otomatik o olur ve bu isim başkasına kapanır. "admin", "dev", "founder", içinde "flipfight" geçen isimler gibi resmi görünen nickler de sadece kurucuya açık.

## Ölçek ve trafik

Render'ın ücretsiz planında aylık dahil trafik 5 GB, CPU 0.1. Trafiği düşük tutmak için:

- **Ada kanalları:** Ada, en fazla 50 kişilik kopyalara bölünür ("ISLAND #2" gibi). Yeni gelen, yer olan en kalabalık kanala girer; oyuncu sol üstteki çipten kanal değiştirebilir. Kapasite `ISLAND_CHANNEL_CAP` ortam değişkeniyle değiştirilebilir.
- **Küçük konum paketleri:** Profil bilgisi sadece girişte bir kez gider; konumlar saniyede 5 kez ve sadece hareket edenler için sayı dizisi olarak gider.
- **Canlı akışlar sadece izleyene:** Oda sayıları sadece Arena ekranındakilere, Market değişiklikleri sadece Market ekranındakilere gider.
- **Sıkıştırma ve önbellek:** JS/CSS/HTML dosyaları açılışta bir kez gzip'lenir (≈216 KB → ≈66 KB) ve ETag ile sunulur; tekrar gelen ziyaretçi sadece "değişmedi" cevabı alır.
- **Oturum önbelleği:** Oturum kontrolü 5 dakika bellekte tutulur, veritabanı sorguları azalır.

Ölçüm (1000 oyuncu adada, 100'ü sürekli yürüyor): sunucu ≈1,4 GB/saat, CPU bir çekirdeğin ≈%4'ü, RAM ≈130 MB.
Kendi ölçümün için: `node scripts/island-load.js http://localhost:3000 <previewKey> 1000 20 100`

## Gerçek tokenlara geçmeden önce

Bu sürüm bir demo. Gerçek değeri olan token ve NFT'lere geçmeden önce:

- Bakiyeleri sunucu veritabanından akıllı kontratlara (MatchEscrow, ERC-20, ERC-1155) taşımak ve kontratları bağımsız bir denetimden geçirmek gerekir.
- Çoklu hesap ve bot önlemleri (aynı kişinin iki cüzdanla kendine kaybetmesi) eklenmeli.
- Gerçek değerle bahis içeren bu yapı birçok ülkede kumar düzenlemelerine takılabilir. Yayına almadan önce kripto ve oyun hukuku konusunda uzman bir avukata danışılmalı.
