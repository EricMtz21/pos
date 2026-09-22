// Catálogo de ejemplo: tienda de figuras y coleccionables de anime.
//
// Precios al público CON IVA, en centavos, a precio de tienda mexicana. El costo es lo
// que cuesta traer la pieza (entre 55 % y 65 % del precio: el margen de una tienda de
// coleccionables es más alto que el de abarrotes, y el inventario rota mucho más lento).
//
// `objetivo` es el stock con el que debe quedar el producto DESPUÉS de las ventas de
// ejemplo, no el inicial: casi todo son piezas contadas, y un catálogo con 40 de cada
// cosa no se parecería a esta tienda.
//
// `peso` es qué tan seguido se vende: un protector de acrílico sale a diario y una
// Ichiban Kuji premio A, una vez al mes.
export const CATALOGO = [
  // ── Funko Pop ──
  { code: '889698546126', name: 'Funko Pop! Naruto Uzumaki #727', gross: 54900, cost: 32000, objetivo: 4, peso: 9 },
  { code: '889698391078', name: 'Funko Pop! Goku Ultra Instinct #862', gross: 62900, cost: 37500, objetivo: 3, peso: 8 },
  { code: '889698521147', name: 'Funko Pop! Tanjiro Kamado #866', gross: 49900, cost: 29500, objetivo: 5, peso: 9 },
  { code: '889698722193', name: 'Funko Pop! Satoru Gojo #1372', gross: 59900, cost: 35000, objetivo: 2, peso: 10 },
  { code: '889698674645', name: 'Funko Pop! Luffy Gear 5 #1269', gross: 74900, cost: 44000, objetivo: 2, peso: 8 },
  { code: '889698761352', name: 'Funko Pop! Denji #1524', gross: 55900, cost: 33000, objetivo: 3, peso: 6 },
  { code: '889698618755', name: 'Funko Pop! Izuku Midoriya #1462', gross: 48900, cost: 28500, objetivo: 4, peso: 7 },
  { code: '889698352857', name: 'Funko Pop! Levi Ackerman #462', gross: 89900, cost: 55000, objetivo: 1, peso: 4 },
  { code: '889698497121', name: 'Funko Pop! Sailor Moon glitter #90', gross: 119900, cost: 72000, objetivo: 1, peso: 3 },
  { code: '889698737166', name: 'Funko Pop! Rei Ayanami #1400', gross: 57900, cost: 34000, objetivo: 3, peso: 5 },
  { code: '889698785310', name: 'Funko Pop! Anya Forger #1602', gross: 62900, cost: 37000, objetivo: 4, peso: 9 },
  { code: '889698759083', name: 'Funko Pop! Ichigo Kurosaki #1553', gross: 54900, cost: 32500, objetivo: 2, peso: 6 },
  { code: '889698574129', name: 'Funko Pop! Pikachu #353', gross: 64900, cost: 39000, objetivo: 3, peso: 8 },
  { code: '889698651905', name: 'Funko Pop! Totoro #1155', gross: 84900, cost: 52000, objetivo: 0, peso: 5 },

  // ── Figuras de escala y articuladas ──
  { code: '4580590174818', name: 'Nendoroid 1932 Satoru Gojo', gross: 169900, cost: 105000, objetivo: 2, peso: 5 },
  { code: '4580590123120', name: 'Nendoroid 1279 Nezuko Kamado', gross: 145900, cost: 91000, objetivo: 1, peso: 4 },
  { code: '4545784067635', name: 'figma 498 Tanjiro Kamado', gross: 219900, cost: 138000, objetivo: 1, peso: 3 },
  { code: '4983164186741', name: 'Banpresto Ichibansho Zoro', gross: 98900, cost: 60000, objetivo: 3, peso: 6 },
  { code: '4983164885231', name: 'Banpresto Grandista Vegeta', gross: 129900, cost: 79000, objetivo: 2, peso: 5 },
  { code: '4573102639240', name: 'S.H.Figuarts Son Goku Super Saiyan', gross: 289900, cost: 185000, objetivo: 1, peso: 2 },
  { code: '4580416944762', name: 'Pop Up Parade Makima', gross: 119900, cost: 74000, objetivo: 2, peso: 5 },
  { code: '4580416946308', name: 'Pop Up Parade Frieren', gross: 129900, cost: 80000, objetivo: 3, peso: 7 },
  { code: '4983164193459', name: 'Ichiban Kuji premio A Luffy Gear 4', gross: 245000, cost: 150000, objetivo: 1, peso: 1 },

  // ── Accesorios, peluches y papel ──
  { code: '7502260410015', name: 'Protector acrílico Funko 0.35 mm', gross: 8900, cost: 4200, objetivo: 40, peso: 22 },
  { code: '7502260410022', name: 'Protector acrílico rígido 4 mm', gross: 18900, cost: 9500, objetivo: 18, peso: 12 },
  { code: '7502260410039', name: 'Base acrílica para figura 15 cm', gross: 22900, cost: 12000, objetivo: 12, peso: 8 },
  { code: '889698624107', name: 'Llavero Pocket Pop Pikachu', gross: 25900, cost: 14000, objetivo: 15, peso: 11 },
  { code: '4521329321479', name: 'Peluche Eevee 20 cm', gross: 47900, cost: 28000, objetivo: 6, peso: 8 },
  { code: '7502260410046', name: 'Caja misteriosa anime (mediana)', gross: 64900, cost: 38000, objetivo: 5, peso: 7 },
  { code: '7502260410053', name: 'Póster anime A2', gross: 14900, cost: 6000, objetivo: 25, peso: 9 },
  // Los libros no causan IVA en México: el manga entra a tasa 0 y el ticket lo desglosa aparte.
  { code: '9786075295473', name: 'Manga Chainsaw Man Vol. 1', gross: 19900, cost: 12500, objetivo: 14, peso: 10, tax: 0 },
  { code: '9786075290218', name: 'Manga Jujutsu Kaisen Vol. 1', gross: 19900, cost: 12500, objetivo: 11, peso: 9, tax: 0 }
]

export const NEGOCIO = {
  name: 'Isekai Store · Figuras y coleccionables',
  address: 'Av. Chapultepec 284, local 7, Guadalajara, Jal.',
  taxId: 'XAXX010101000',
  phone: '33 1234 5678',
  footer: 'Cambios en 7 días con ticket y caja sellada. ¡Gracias por tu compra!'
}
