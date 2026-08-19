import { coinTypeFor, type ChainProfile, type DerivationScheme } from '@qbtc/crypto'

// The chain profile: everything that makes this build's chain THIS chain from
// the wallet-crypto perspective — derivation schemes, address magic, WIF
// versions, HKDF labels, signed-message magic, conversion parameters.
// @qbtc/crypto ships no chain constants; this file injects ours, and ./crypto
// binds it into the facade the rest of main imports.
//
// BRAND FILE: like the node's chain parameters, brand branches edit these
// values in place. This is the QBitcoin brand.
//
// FROZEN on a shipped brand: every value here except the `upgrade` display
// limits is consensus- or storage-affecting — changing schemes, magic, HKDF
// labels or WIF versions after shipping strands user funds or data. Pin
// tests: tests/unit/brand/profile.test.ts.

/**
 * The QBitcoin derivation scheme. coin_type 2009 (SLIP-0044, obtained
 * 2026-07) on mainnet; testnet follows the BIP-44 convention with the
 * shared testnet coin_type 1 — which also keeps wallets created before
 * registration discoverable there (the placeholder derived everything
 * from coin_type 1). No wallet ever shipped deriving mainnet funds from
 * the placeholder, so there is no legacy scheme to carry.
 *
 * FROZEN once shipped: id, coin_types and the path shape hold user
 * funds — never change them; add a new scheme instead.
 */
export const SCHEME_QBT: DerivationScheme = {
  id: 'qbt-v1-slip44',
  coinType: { mainnet: 2009, testnet: 1 },
  label: 'QBitcoin v1 (SLIP-0044)',
  status: 'active',
  pathTemplate: (account, change, index, network) =>
    `m/44'/${coinTypeFor(SCHEME_QBT, network)}'/${account}'/${change}/${index}`,
}

// QBitcoin downgrade: the freeze covenant's IF branch is a 2-of-3
// CHECKMULTISIG over the downgrade federation's Falcon-512 pubkeys (the
// node's QBT_FREEZE_PUBKEYS, per network — inlined below the way the node
// inlines them into the script); the reclaim windows are the node's
// consensus constants. The single-key covenant that predates the federation
// stays configured on testnet as the legacy era: real freezes exist there
// and remain user-reclaimable (the mainnet chain never ran it). Scripts and
// addresses derived from these are pinned in tests/unit/brand/downgrade.test.ts.
const QBT_FREEZE_PUBKEYS_MAINNET: readonly string[] = [
    '099dfc7296b6951f0310958069658d1e2dab2b5a5c77ae72c96a384a149db447e81b202d1c40917b5fad050bae' +
      '45a27a861312295e3b80eeb20150468add4cd244bdc9d15f8e583531ecd6de8b5e09ddfbb3a01ea03ddc8bc4e5' +
      '12ec9ae02381cb18f4ad4a065514677902d91d484e093ab19017791fc991382a1581cae7aea8e18253350ec704' +
      'a49978324614706091e05720bc1e5e71444de76db22cf3053fccc92b24c20989ddc1b6091156e76b5238d62965' +
      'bd1533994e0096c943742c4c7ba74fe2c2911032049657023e4c9e415dee787c6cc217cb23473820fdb657ed8f' +
      '5c91d2f4a46da97c3e75204643bc83c079a1dcd5dc6e6e7562736baf0cd6d8bbefe6d16215ea3b2d865497ce60' +
      'f4e540b0a8223f8630aaa268a4f2c95168e16e4820bb8da2f24b424f4b3ccb2615a987d0e503908871221171e1' +
      '662ef2a4eb016f5b6b217bc7384b3a2564bdc4722870604d71841612cda748f3ba90e1af4c3c43aabc97163e9d' +
      '3d502085b5aa956523b0a0fc4308126021dded74651506df5c6d15ec4be36115d874c8b4c3caae21beadeaa51c' +
      '141a58e98959c164279055f9c467ef8f79925bfa8e89eb50d4c923dae19d39b8195264551b4249b3e353d1efa3' +
      '55fd97322d78aa5521f6cf17d93cb012a5114a3e5d71e9c673190118aea234064a41024940f8dc8f0c3b84b44a' +
      'd0a6cbade0e9f84ae47803167a2782edc87278d7135dc88d9f22f81485223ba6f44cb8a854fa7eb813c255a52e' +
      '8d7a7aa1adc0d28968acb7aeda282f4137a32621d699cde5b1f942a47ad514078a2a679f1806f6b710428d55e0' +
      'bbc092628ca6f9488b48e85a5cb4388f65a6be45bd22590772354649d927ea542b34d1d0ef473bb23acacb3e5a' +
      'a059093b3252da8e4dc5cac6c987da24d8437925aff0239ab69594988e1156bba6bb25033e0a20353340a09f01' +
      '002ad16f159be8cb077b09d892f10885b51c6121f9e7d7f0ac61660a5d730347f34c59165b17a32244da0d4215' +
      '25147975aa8bbc8f4915362ca28a8d1a75627a5808d85107626ac305ce8d1c01eba7b29854a61545a68c51c159' +
      '7a2238ce42aa51601fc8d35ac83c7dd4fb4bdf91161a39b315d511335d9087beda868d1ead316045786624b081' +
      '6dc1ea8aaee89735920e3dbd604a64422659aa2cc4e59d3ab87856d26a07a594754769d0a21a465427ba4d27b7' +
      '1578ed452a96af3818ee453be504aad8620357505b63e6030bb701e337683422c681469c4e01a8dfe13b',
    '092d86e8112b495797a6a3c6b7060d84769806074c3c29f6fbbb98db3b98c224eb2443749b1a8bc4682b949055' +
      'da39491a57ba1d1b96b19f9a3c28d3f76c9fb95e762cba84293cbca867f13fc1d580942eb69ad7e0827acca9e7' +
      'ca9a2e6984a9ee4bc0b20a85c3af27fb39aa7b340f6afbbd88bcd817d2550040b600234480a93ccaa3204f9f2e' +
      'a221bab982c8184e40b7c2e7c137bde7b1d484021b3efeb508ecd862982a049894aa0189a19324c8b550829e87' +
      '9484a67b60ac42e456f86bc576305daae679352f14d65f95ae2492a81a0fcfa38abdf8325c073d8c026116c113' +
      '04e5236117c54e6d9232d21c983b1fe6025baac92ca7067c28922c91b150f7fb38c551a5a40ab104dbaf448927' +
      '659f5b69a454e9d840d83b629e6467fd4a505a6ed917934b42176d7da4d12871bbf286966087eca15ac5927a6f' +
      '192b7122dac2d9e02c7d9094c1e419b55c3a78bb0db006fe46458900febcd5b7e78395e02e9699f1415bcb305e' +
      '0d79f5828e7afeac14796f1e5774f4b20b461d7e8472967f5a68b1e24c6b3e1f5bbb4d0061c760ca4b79c8d80e' +
      '991eb9e5cba8dbd79436825091484a98a3860a3a324c8ba75c2766a9187867942022c2d632125c6171abd25f59' +
      '8ce214c44b9f60b529e926ca809fc542c65341b93282692a99a93b1d963aa5a85d2d099e6c642fe0340ca1af59' +
      'caabf44feeb7a6691ab02a89dee8c5a32419b62f97708ebe32cc63508768230dac12048a9daf16d0a5aba79170' +
      '907a82e390513179dc93dad050952a905c8907c1f2776df276beaf750922c2f20ad0fc69c549819aadf779f5b0' +
      '120c15089cc21755f8601e13aed1a2c71c38ac1e44e0376b0f12496a3052d84e40ba2a953bd48e7a1e37170244' +
      'de32604fb2afd193af528c37a95ea12d7c3205ee25dab959ab67b70ead7118ac043204ea6ec4a0230b976e4bd6' +
      '35215fe2e78b2973035a65c379b98e7044644389b16357b380201462688a155f9a71d10bcbf640f431cee12233' +
      'ae51afd82191bdd9b7483a9bc036a9300111efe27cc56056866f19a2afcb20aa06404ddb165861d972895abf84' +
      '987599e2c7bf8ac074d6e39e386be1d17bf887e6091cb906e79ce3771e6db3602fc00e624d7504e92c09e07564' +
      '6303c63014daf5fd56221c4656a5c3c8a2464a8a33bdeeb005166ac2cad1bd93dda96572073370b09367ac5e0a' +
      '548cf1817784daafc58ef73fa58ab27980496d6a6ea68af8c372a70e011900512816e2851e850bda1a78',
    '098969b559cfe0ca3e81aaaa89991e31393738dd05ec0d9447c0bd008cacb27a1a70cfd543c624aa032e9e01aa' +
      '0a79ac936e4aae06ebfce5ebabf1112ac2542c74cd61e1cd904f03e4c3d86baaa2654dfe6a07a3d19275254757' +
      '575f2c88923a3fddd86a8238517a8d9d0f2ef1c8108fed597048d7186c0053d170f6d0251795703e2470ec4719' +
      '2466db122a818f744f1b8513e36fad77278d262a24a086b81a983320e575907212235a8012abac492843f173a7' +
      '6a84a482548f0ae86c396864d214ca860c5f25eaf3b76c85ba09e16673c776a55e3359bdce0f82c5ae7879ede2' +
      '7b2111e2196729a308e150b7abf597a20253806be1888a2330f392c54e2ed46b5741c49cb63952cb68e13f66e9' +
      '383a618966783e62ced40c2b9acb2baed5fa375c8c757c26946e00a875070a245e31fdf5e5181236382d82ed41' +
      '2db22ce4c9154511749909a0ff8cab9e547f5ab51d83030ca6d6dc2ee2b662c561a624642e51d7a0fc43e847f2' +
      '83a5d353ca0761f8489ce7bb96f200621b014955b2e87199d7931e028ff2b4a8186c7d1343336113afbd503b9e' +
      '64d9214d3153a3ea520dc637a1ce0e5a41468c77c2aa6eba5d8bfb23c1d65f327ef40669e2681dcb306293361c' +
      '1084995062bd3b1a4b33fc2a8579c978d106ea53af0107dab0ef9eb3a4d3086f5303229c5543124d86073d5ca4' +
      '3765327f6858aacd0916a4083a9bd5aa00bd1dbcf97506bb9dfeca79e3477281a8750afe22c6bd9129ca416444' +
      '2fae853827c94f70a852a7bc6e3d7a5c8e65bb9f58985662750a93f9b75152524329edb35e01ab51627924cc48' +
      '93590b496d5ec5a1186a4e9b69b521874a1f271e49c0b627ef21f4b8d6c5685d5aa46b4133eb49bf28a5d6206f' +
      'd736010f2394238993b67ad1c3237c2a9155d7abacd068fddab294cf3029b42a26b69adfb2445e057063b26d54' +
      '85628491d1a78a2510a6d38c6881f9fbcec2649d00e987028d718f3c3b790fe6d26efa845a2cd685a42d719166' +
      'da9238860b01e3ec0a6e9db3191fd45c13aa8d239f516a3275a087b1022b5d21a103bb066b47a612a3db81b771' +
      '857920482dc4b140dea3fc03b57b22d0737688dea8886e098d19fdbfa581e13fab0393789a3062afa67e1eb45b' +
      '37663c7771b8c25123ae1894fc3b69d0d079711f296d9cab97c15035dfc2497a312c586e6124519dc7d89ee6b9' +
      '16fa51619b0ae66050321087570070e825f88612ac0b9e86848d951a9c60a1f718102323c1d36134ec70',
]

const QBT_FREEZE_PUBKEYS_TESTNET: readonly string[] = [
    '09bdb85ee8f805c54de6c505c8af4a94ce2f29682de71b75809ae79567aab432d2fea163a90831d74f86a35a1a' +
      'b515a16fb79eb8e0c4dd59561c9972756b9e1653f98c06eda274b4ced2f76001b2834a1f250450c31664841810' +
      'e1dda7c1bd732e88e1b6fe95f0b419f08059cac5ae40c98a851f44f02ea0a93a49a2e1cba733162894ceeb6a93' +
      'ce4fd810c19e7060c85251957008162b479de70607ce756b3603455b11cea302e3553f8a09303d2fe347a826f8' +
      'c5dacc218584a678cd4044b2c8325982b94c1863d636603255f86b57024f273d2ded81d9c49e5a099de128ec92' +
      'a1f9a4c569dd5b24417023b2c45f028c25ea7be3d44ef87d45204a444dace0752f6f933bfe0dd135d39e5c6956' +
      'c5e45b21919e1f26ec2802871e7b3964689a7f85d6b5179a7a6ce0f3aad8e44990e2d145ae8e000b993ef67848' +
      'ad16edb8047851a09d9938c1c22d07a33d2b134ddb1102cee94b50ed6583ec108449d847a44019b525db78287d' +
      '557b11dc40b34e2db44b569503f5d9638aab5b0db834d4cc137100ec02d3eca8f41ab693882a48ab0ac585789e' +
      '223355c04de2c221fba50e2dda8a0d3321808c246716566afdda98f0c2a64be5208787552b8b1811a2552950ad' +
      'bed15a98ce5c66b80466115d265a68d58270e772494469e2671fb89d5dc0b610e37a8648c892edc47f0496eab5' +
      'c329671d066ed7272e5469358ab4ea6bdb8a912341fb56a0b54e88e62acb37345cdbc21ed646986ca13231a238' +
      '83099c01058efd3b657305ea5605055241b3146769529219f58b1ccb1301e408dd462e9212bf0414d2a607fe33' +
      '932169f3079c08bbbf67a64452e1a08555a2aaedacb7a06d44a344b164c6acfc4ad65cf94a266688aaaae92205' +
      '55687a2845498879a0ea8734a2544f4c959d32facf81125a9c48aeecbe16be923918900ca151b4a69ecbc59045' +
      '0c48f21414b7c40ec57f927b57fcdd9751e9b458689ed3bb11ad26a1690153d7d605196cb438233d380aa7f2cd' +
      '0bc58ae5922031c31ea52957f0b0ae65a43de1a0665eeb8a9e5370ba8d244edce23b971fe1bf2ca22247c8f55d' +
      '74247064c8bc39cdaad4bd5bf485b4afe0089d74452d5ec7ba13058235cf60de2264600de26596806169813a31' +
      '0ae0f9a52ef7947a562a29be260ac19c014e8dad7387e930ae7aa1469dca9d9ed829f2ae9a3c6b14a79920dc9b' +
      'b4e0abf35f13b8a618eb1864ab24632640556125a746c88da415c24649f15387128e30bf1ae9803566da',
    '091a3a73d126ccf2ab318bc4eb6dd97a0a77f02ea9c1445d4b78440b2d7aa1a0b7c645d80f61e92044ea479302' +
      'f1b307833e031678e1d69cac7b9884a04787c34562c1b43d194346daf288ff5988018ef7180c07697704adf141' +
      '5cd7687173e43407c8bbfd950686e701b128a87b7985a601d68cb1e6126247d1b955d11924b2a243f445a2c443' +
      'fa4710d7af5e86794eb27213635b241d847aa56f2472405a822216ab3109e7291ba60f980bfa8c6f4208cd2ad3' +
      '20a2235768ec08d0d920a43a1f393f071814d8543a80581c4920bfb504c0378cdc0020dc8f4c62b48e4934121e' +
      '15f2c1d14944d8341d1a6315067685288892421b3e77be3e46164495537ef4357c4b036305854b1186be011911' +
      'd93282da25aa0b50ffe4ce2489c378dd92ef9b507c65bd080c907a5ce46dd49e8bda9b64a5075b592c8f56b89b' +
      'db43adbb9b3b232a71728a747a878f00f46f84c08216b508b3077f9ef835eaaa3429232669cdfe9451e3e34459' +
      'ff3b074bd90c4003414ea3368c49fba9ab27ff25ac3544342cc53241570a988a7530d15fe5c01bcb48b8d2920a' +
      '99978c004b226707bb23b52072cc0bca177ae5f0eddbcf3766be04b8defd131c3ac29c86022fbcbf04d620b061' +
      '163a59a9182c40988019c50ce78e1a921380a414781c5294de14a626ecd6560465e9291428c98ede1d1dbcca4b' +
      'e853ef511ed993f66b1769a96ac302cc583fc235a0395653913225245691deaa04bd357b12e777718c62e66281' +
      'aa5632d35e48983142fc1365e47f8bb8911579e3bcbf10b8fac1c95b4eb1b8db6b6e49a41d3a7ada64968828be' +
      'b904c96c5dd0b50be71f0aa2b5a124871c7093f8129543ade5526ce62013a512483ecfe898cd24125c53b8dfde' +
      'b73ac6d3e32d0c1465b98e2356dcc70b1979842c9ac7183299a8b3e5c54714931a33d8cf29d58481ad44af38ad' +
      '577294ca957cd012e2dc28c96e9e8233039a3d9cb91a28af1c69532895050426693e4d2b61076d5b4401fe53bf' +
      '93e49f204ad7d058bdbfa504950e2e5730a60573de253d82b14e83ad2ec380e5ad67ec4a1908e02c434d68c13a' +
      'c18071d761ce18ce4bc84210b86441c351a68a5e51190ee7e361411b8406d04a6ee82902d0b04eadaa481894b0' +
      'ffe4cb1b99c5834dc8bd061a0a917bab7c6325de083ce9ca457cfbc6e41c03a295b432fa87a43860b358785c8d' +
      '9ce59772638dfd1f806f178dd1206f189fdbdf1013335e4ba397176e29864e59c5aed976aa8ec5a105f5',
    '098b44ee70a495ea46d483dbd016541ef251b4c95bfa55fdb0ab2717dcbd81ab9ae09c178b96342a476aff465d' +
      '15b0f1a6404ca654823c82f72faa652013c489041aaf8424a7a7b1a642e4fcc50f83207619209c49b15a65500a' +
      '6dee225e853965cf30ae7676d76c212163946272f35ee83739b789660c1c1714356b47e90f4f65eb5340d8bb44' +
      'e867636a1868101d4c779a615163459f79e9eb7365d5b4363d23f54120ddbb836ecca7e81b9bcdc84125384ffb' +
      '2aad4654e92768f4a70c67c48101272caebceab1db69da8966ccb8a35741e78ea0efc62fd7bab8d447c285084e' +
      '9aa17fa2800f45ac6472a50f09fc078d5b50054ab268b6c34270de872a651582498aaf217d83727e4e9482b9b9' +
      '34dde8d424180b998a6fb3958962906d5ce21b415bd7dbce6229a239592824330949cb857c92313e041c54fb4b' +
      'd14f18bed46f138f42e15a61bd46df4b8c131ac282ae877da7fb708a6323b9eab58318072af82024e9676b0f41' +
      'f4c6bd8297bab1e814d0ea57ac12877001e410b66076970e098d2b288dbb09e7de3c86199b65a013876691665a' +
      'a65fa23c88e76252360e19abc6635cde889aba81de1019387adc007aae1a5e31db522a937588ad7785c5dbb319' +
      '3958b49063574942db75e7a2db60b0b613b551852b808a16f362baa1c67d995451fd8ec97dd466c8ed5f7ab701' +
      '57616719aa3ee81fa2f71ffc2a18b3ed5eaa2ea11b0657fda9b15559f960a55f8af03720d863008a9d4570c27e' +
      '513dde8260af33b9e5d62b8ced1c1ac99c1a332a07030177287f520aafca04242661ca5b485bf804160174fc09' +
      'b9f586a5af722808246064358eda680a6bf05bea24e1efdeda6df49b117be9f262f1ac92aa28751dfe17772b5e' +
      'b2bcc6be94326f5a5ebc93e864ef4f46b5a056bc50cb4b549a709e0971459ce6a85c6659a0f480409b91185c60' +
      '02e280a94fbfc5d4e8c2aafb0b554fa96797eb1e8681b01869597c3e7d76d340f0b84184d2f320b6bfe6db708d' +
      '80c59d88ffbb8b1cfc1b810810de1e900828ea858ee82c3bedc10aee18370a92698b62d59cbce28aa596859489' +
      '28a2917109ee8e6ef00957df8dac815ce8cc24e42f480957d49dc8a8c4a3a3e00e474722bd8a6a51bf39b053f0' +
      '8769af7e12067155862712015e979f811f5046e8d1185ea94c8dabe16c0ecf3dca28332c415998e453c662c860' +
      '0f36c5039dd1e22e3de4973300043c7d5005ffa1ed204dcb61024477aeb28eb71581a44ad0d4757543ba',
]

export const PROFILE: ChainProfile = {
  /** Diagnostics-only label (error messages). Not consensus. */
  name: 'qbitcoin',

  /**
   * Address magic prefix per network, prepended to the scripthash before
   * Base58Check encoding. Lengths differ per network (the QBitcoin testnet
   * uses 3 bytes) — the decoder always takes the length from here.
   */
  addrMagic: {
    mainnet: Uint8Array.of(0x13, 0x9d),
    testnet: Uint8Array.of(0x04, 0x73, 0x89),
  },

  /**
   * Address-shape pre-filter per network, matching the node's own address
   * regexes byte for byte. Two shapes each: classical (HASH160-based) bq…
   * (35 chars) / btq… (36), post-quantum (HASH256-based) 3u[H-K]… (52) /
   * 3ua[2-4]… (53). The character classes are the EXACT reachable ranges for
   * the magic bytes above.
   */
  addressRegex: {
    mainnet: /^(?:bq[1-9A-HJ-NP-Za-km-z]{33}|3u[H-K][1-9A-HJ-NP-Za-km-z]{49})$/,
    testnet: /^(?:btq[1-9A-HJ-NP-Za-km-z]{33}|3ua[2-4][1-9A-HJ-NP-Za-km-z]{49})$/,
  },

  /** One-byte WIF version prefixes (Bitcoin-compatible envelope). */
  wifVersion: { mainnet: 0x80, testnet: 0xef },

  /**
   * Every derivation scheme this chain's wallets know about, in scan
   * priority order for funds discovery. Exactly one is 'active'.
   */
  schemes: [SCHEME_QBT],

  /**
   * The scheme that owns data persisted BEFORE storage became per-scheme
   * (wallet meta without a `schemes` map, version-1 watch descriptors). When
   * a brand adds a new active scheme this stays on the ORIGINAL one —
   * re-attributing old blobs would shift issued-index floors onto the wrong
   * branch.
   */
  metaV1SchemeId: SCHEME_QBT.id,

  /** HKDF label of the Falcon-512 keygen-seed derivation. Versioned. */
  falconHdInfo: 'qbt/pq/falcon512/v1',
  /** HKDF label of the app-data (address book etc.) encryption key. */
  appDataInfo: 'qbt/app-data/v1',
  /** Signed-message magic prefix — Bitcoin's convention, brand-flavored. */
  messageMagic: 'QBitcoin Signed Message:\n',

  /**
   * BTC→QBTC upgrade: BTC paid into the node's per-network QBT_LOCK_SCRIPT —
   * a federated 2-of-3 P2SH-P2WSH over the operators' QBT_LOCK_PUBKEYS — is
   * credited as QBTC; see the node's coinbase rules and chain parameters.
   * The wallet's native network maps 1:1 to the BTC side: mainnet ↔ Bitcoin
   * mainnet, testnet ↔ Bitcoin testnet4. The scripts below are derived from
   * the operator pubkeys pinned in tests/unit/brand/upgrade.test.ts; the
   * deposit addresses are 3QBTC3wxgSPUbKLqjZjh6aGwM3yKHWhaLU (mainnet) and
   * 2MtQBTCa85CFPFa45Tc19DmuYa3XhfSuD8D (testnet, live: the pool already
   * holds funds there).
   */
  upgrade: {
    mainnet: {
      // OP_HASH160 hash160(OP_0 <sha256(witnessScript)>) OP_EQUAL
      lockScriptHex: 'a914f6b3819e0774b3e2730805e9f4b55d9dc9c539f287',
      minConvertValue: 10_000n, // 0.0001 BTC — below this the 1% + fees make no sense
      dustLimit: 546n,
      feeTargetBlocks: 6,
      fallbackFeeRate: 2,
    },
    testnet: {
      lockScriptHex: 'a9140ca9c0a78b49f708d18fcdd36ea47a92e1d9bbb987',
      minConvertValue: 10_000n,
      dustLimit: 546n,
      feeTargetBlocks: 6,
      fallbackFeeRate: 2,
    },
  },
  /**
   * Native→BTC downgrade: the federation era per network (the key arrays
   * above); testnet also carries the retired single-key era.
   */
  downgrade: {
    mainnet: {
      freezePubkeysHex: QBT_FREEZE_PUBKEYS_MAINNET,
      freezeSeconds: 48 * 3600,
      outputSeconds: 7 * 24 * 3600,
    },
    testnet: {
      freezePubkeysHex: QBT_FREEZE_PUBKEYS_TESTNET,
      freezeSeconds: 48 * 3600,
      outputSeconds: 7 * 24 * 3600,
      legacyLockPubkeyHex: '02943a59688f1eceb1d068f6ac0ff84c8f17b2c3714269aec2185422cd61b748b6',
    },
  },

  /**
   * When transaction sign data starts committing the token id, per network
   * (unix seconds): 0 = since genesis, null = never. Must mirror the brand
   * node's fork schedule — before the fork the node rejects signatures that
   * commit the id, after it those that omit it.
   */
  tokenSighashFork: { mainnet: 0, testnet: 0 },
}
