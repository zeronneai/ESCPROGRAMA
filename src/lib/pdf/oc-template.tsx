import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { PDF_FONT } from "./fonts";

/** Purchase Order de ESC (replica del formato en Word que se manda a los proveedores). */
export interface OcPdfModel {
  folio: string;
  fecha: string; // YYYY-MM-DD
  proveedor: string;
  contacto: string | null;
  enviarA: string | null;
  firma: string;
  lineas: { modelo: string; producto: string; cantidad: number; precio: number | null }[];
}

const MESES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function fechaIngles(iso: string): { mes: string; dia: string; sufijo: string; anio: string } {
  const [y, m, d] = iso.split("-").map(Number);
  const sufijo = d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th";
  return { mes: MESES[m - 1], dia: String(d), sufijo, anio: String(y) };
}
const dinero = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cantidadTxt = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString("en-US", { maximumFractionDigits: 3 }));

const AZUL = "#1f5fbf";
const s = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 90, paddingHorizontal: 34, fontSize: 10, fontFamily: PDF_FONT.regular, color: "#111" },
  logo: { width: 150, height: 43 },
  title: { textAlign: "center", fontSize: 14, fontFamily: PDF_FONT.bold, marginTop: 8, marginBottom: 14 },
  fecha: { textAlign: "right" },
  folio: { textAlign: "right", fontFamily: PDF_FONT.bold },
  prov: { fontFamily: PDF_FONT.bold, marginTop: 6 },
  saludo: { marginTop: 14 },
  tabla: { marginTop: 12, borderTopWidth: 0.8, borderLeftWidth: 0.8, borderColor: "#333" },
  tr: { flexDirection: "row" },
  th: { fontFamily: PDF_FONT.bold, paddingHorizontal: 4, paddingVertical: 2, borderRightWidth: 0.8, borderBottomWidth: 0.8, borderColor: "#333" },
  td: { paddingHorizontal: 4, paddingVertical: 2, borderRightWidth: 0.8, borderBottomWidth: 0.8, borderColor: "#333", color: AZUL },
  tdTot: { paddingHorizontal: 4, paddingVertical: 2, borderRightWidth: 0.8, borderBottomWidth: 0.8, borderColor: "#333", fontFamily: PDF_FONT.bold },
  bloque: { marginTop: 16 },
  b: { fontFamily: PDF_FONT.bold },
  firma: { marginTop: 26, fontSize: 11 },
  pie: { position: "absolute", bottom: 26, left: 34, right: 34, textAlign: "center", fontFamily: PDF_FONT.bold, fontSize: 10.5 },
});
const W = { model: "17%", product: "45%", qty: "11%", price: "11%", ext: "16%" } as const;

export function OcDocument({ m, logoSrc }: { m: OcPdfModel; logoSrc?: Buffer }) {
  const f = fechaIngles(m.fecha);
  const total = m.lineas.reduce((a, l) => a + l.cantidad * (l.precio ?? 0), 0);
  const nombreContacto = m.contacto?.trim() || null;
  return (
    <Document title={`PO ${m.folio}`} author="ESC Representaciones S. de R. L. MI.">
      <Page size="LETTER" style={s.page}>
        {logoSrc ? <Image src={logoSrc} style={s.logo} /> : <Text style={s.b}>ESC</Text>}
        <Text style={s.title}>PURCHASE ORDER</Text>
        <Text style={s.fecha}>
          Chihuahua, Mexico, {f.mes} {f.dia}
          {f.sufijo}, {f.anio}
        </Text>
        <Text style={s.folio}>Purchase Order No. PO {m.folio}</Text>
        <Text style={s.prov}>{m.proveedor.toUpperCase()}</Text>
        {nombreContacto ? <Text style={s.b}>AT´N {nombreContacto.toUpperCase()}</Text> : null}
        <View style={s.saludo}>
          <Text>Good day{nombreContacto ? ` ${nombreContacto}` : ""}.</Text>
          <Text>Please send us the following product:</Text>
        </View>
        <View style={s.tabla}>
          <View style={s.tr} fixed>
            <Text style={[s.th, { width: W.model }]}>MODEL</Text>
            <Text style={[s.th, { width: W.product }]}>PRODUCT</Text>
            <Text style={[s.th, { width: W.qty }]}>QTY</Text>
            <Text style={[s.th, { width: W.price }]}>PRICE</Text>
            <Text style={[s.th, { width: W.ext }]}>EXTENDED</Text>
          </View>
          {m.lineas.map((l, i) => (
            <View key={i} style={s.tr} wrap={false}>
              <Text style={[s.td, { width: W.model }]}>{l.modelo}</Text>
              <Text style={[s.td, { width: W.product }]}>{l.producto}</Text>
              <Text style={[s.td, { width: W.qty }]}>{cantidadTxt(l.cantidad)}</Text>
              <Text style={[s.td, { width: W.price }]}>{l.precio != null ? `$${dinero(l.precio)}` : ""}</Text>
              <Text style={[s.td, { width: W.ext }]}>{l.precio != null ? dinero(l.cantidad * l.precio) : ""}</Text>
            </View>
          ))}
          <View style={s.tr} wrap={false}>
            <Text style={[s.tdTot, { width: W.model }]}> </Text>
            <Text style={[s.tdTot, { width: W.product }]}>TOTAL</Text>
            <Text style={[s.tdTot, { width: W.qty }]}> </Text>
            <Text style={[s.tdTot, { width: W.price }]}> </Text>
            <Text style={[s.tdTot, { width: W.ext }]}>${dinero(total)}</Text>
          </View>
        </View>
        <View wrap={false}>
          {m.enviarA ? (
            <View style={s.bloque}>
              <Text style={s.b}>Ship to:</Text>
              {m.enviarA.split("\n").map((t, i) => <Text key={i}>{t}</Text>)}
            </View>
          ) : null}
          <View style={s.bloque}>
            <Text style={s.b}>Bill to:</Text>
            <Text>ESC Representaciones S. de R. L. MI.</Text>
            <Text>Ave. Heroico Colegio Militar No.5910-C</Text>
            <Text>Chihuahua, Chihuahua</Text>
            <Text>Mexico   CP 31105</Text>
            <Text>Tax ID: ERE-060228-NLA</Text>
          </View>
          <Text style={s.bloque}>Regards</Text>
          <Text style={s.firma}>{m.firma}</Text>
        </View>
        <View style={s.pie} fixed>
          <Text>ESC Representaciones S. de R. L. MI.</Text>
          <Text>Ave. Heróico Colegio Militar No.5910-C, Zona Industrial Nombre de Dios, C.P. 31105</Text>
          <Text>Chihuahua, Chihuahua México   Tel: (614) 424-6200    Fax: (614) 424-5653</Text>
          <Text>www.elsauz.com</Text>
        </View>
      </Page>
    </Document>
  );
}
