# Flipfight

Pixel art NFT kart düellosu. Oyuncular MetaMask ile giriş yapar, takma ad seçer ve gerçek rakiplerle canlı eşleşir. Tüm tokenlar ve kartlar **demo** varlıklardır ve sunucunun veritabanında tutulur; zincire hiçbir işlem gönderilmez.

## Neler var

- **MetaMask ile giriş:** Oyuncu ücretsiz bir mesaj imzalar (işlem değil, gas yok). Sunucu imzayı doğrular ve 30 günlük oturum açar.
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

## "Coming soon" modu

Varsayılan olarak açık. Siteye gelenler tanıtım sayfasını görür; oyun, hesaplar ve veriler arkada çalışmaya devam eder.

- **Önizleme:** Render'da `PREVIEW_KEY` değişkenine gizli bir değer gir. `https://flipfight.fun/?preview=GIZLI_DEGER` adresini bir kez açan tarayıcı 90 gün boyunca oyuna girebilir.
- **Açılış:** Render'da `COMING_SOON` değişkenini `off` yap. Servis yeniden başlar ve oyun herkese açılır.

## Mobil oyuncular

Mobil tarayıcılarda MetaMask eklentisi yoktur. Site bunu algılar ve "Open in MetaMask app" düğmesi gösterir; oyun MetaMask uygulamasının içindeki tarayıcıda açılır.

## Proje yapısı

```
server/index.js    HTTP API: giriş, profil, deste, paket, bonus, lider tablosu, geçmiş
server/match.js    Kuyruklar ve maç motoru (Socket.io)
server/db.js       Postgres bağlantısı ve şema
shared/game.js     Kartlar, odalar, paketler, kurallar
public/            Oyun arayüzü (HTML, CSS, JS)
scripts/smoke-test.js  Uçtan uca test
```

## Gerçek tokenlara geçmeden önce

Bu sürüm bir demo. Gerçek değeri olan token ve NFT'lere geçmeden önce:

- Bakiyeleri sunucu veritabanından akıllı kontratlara (MatchEscrow, ERC-20, ERC-1155) taşımak ve kontratları bağımsız bir denetimden geçirmek gerekir.
- Çoklu hesap ve bot önlemleri (aynı kişinin iki cüzdanla kendine kaybetmesi) eklenmeli.
- Gerçek değerle bahis içeren bu yapı birçok ülkede kumar düzenlemelerine takılabilir. Yayına almadan önce kripto ve oyun hukuku konusunda uzman bir avukata danışılmalı.
