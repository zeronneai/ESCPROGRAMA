import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { PDF_FONT } from "./fonts";
import { COLUMN_HEADERS, type PdfModel } from "./model";

/**
 * Plantilla del PDF de cotizacion (replica del formato actual de ESC).
 * Esta es la UNICA pieza que depende del diseno: para cambiar el formato basta con reemplazarla.
 * Recibe solo el PdfModel (datos que el cliente puede ver).
 */
const W = { te: "17%", name: "33%", cant: "11%", cur: "12%", up: "13.5%", price: "13.5%" } as const;

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 60, paddingHorizontal: 36, fontSize: 9, fontFamily: PDF_FONT.regular, color: "#111" },
  head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  headLeft: { width: "46%", flexDirection: "row", alignItems: "center", gap: 8 },
  logo: { width: 105, height: 30 },
  brand: { fontSize: 11, fontFamily: PDF_FONT.bold },
  small: { fontSize: 8, color: "#333" },
  headRight: { width: "50%", textAlign: "right", fontSize: 8, lineHeight: 1.35 },
  title: { textAlign: "center", fontSize: 16, fontFamily: PDF_FONT.bold, marginVertical: 8 },
  box: { flexDirection: "row", borderWidth: 1, borderColor: "#999", marginBottom: 8 },
  boxCol: { flex: 1, padding: 5, borderRightWidth: 1, borderRightColor: "#999" },
  boxColLast: { flex: 1, padding: 5 },
  label: { fontSize: 7, color: "#555", fontFamily: PDF_FONT.bold },
  value: { fontSize: 9, marginTop: 1 },
  to: { marginBottom: 10 },
  th: { flexDirection: "row", backgroundColor: "#e5e7eb", borderWidth: 1, borderColor: "#999", fontFamily: PDF_FONT.bold },
  tr: { flexDirection: "row", borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#bbb" },
  cell: { padding: 4 },
  right: { textAlign: "right" },
  desc: { fontSize: 8, color: "#444", marginTop: 1 },
  totals: { marginTop: 6, alignItems: "flex-end" },
  totalRow: { flexDirection: "row", gap: 14, fontFamily: PDF_FONT.bold, fontSize: 10, marginTop: 2 },
  band: { backgroundColor: "#fde047", padding: 5, marginTop: 8, fontFamily: PDF_FONT.bold },
  footer: { marginTop: 10, lineHeight: 1.5, fontSize: 8.5 },
  pageNo: { position: "absolute", bottom: 24, left: 0, right: 36, textAlign: "right", fontSize: 8, color: "#666" },
});

function Cell({ w, children, right }: { w: string; children?: React.ReactNode; right?: boolean }) {
  return <View style={[s.cell, { width: w }]}>{typeof children === "string" ? <Text style={right ? s.right : undefined}>{children}</Text> : children}</View>;
}

export function QuoteDocument({ model, logoSrc }: { model: PdfModel; logoSrc?: string | Buffer }) {
  const c = model.company;
  return (
    <Document title={`${model.folio} - ${model.empresa}`} author={c.razon_social}>
      <Page size="LETTER" style={s.page}>
        <View style={s.head}>
          <View style={s.headLeft}>
            {logoSrc ? <Image src={logoSrc} style={s.logo} /> : null}
            <View>
              <Text style={s.brand}>{c.nombre_comercial}</Text>
              <Text style={s.small}>Tel. {c.telefono}</Text>
              <Text style={s.small}>{c.web}</Text>
            </View>
          </View>
          <View style={s.headRight}>
            <Text>{c.razon_social}</Text>
            <Text>{c.direccion}</Text>
            <Text>{c.rfc}</Text>
          </View>
        </View>

        <Text style={s.title}>COTIZACION</Text>

        <View style={s.box}>
          <View style={s.boxCol}><Text style={s.label}>Fecha</Text><Text style={s.value}>{model.fecha}</Text></View>
          <View style={s.boxCol}><Text style={s.label}>FOLIO</Text><Text style={s.value}>{model.folio}</Text></View>
          <View style={s.boxCol}><Text style={s.label}>CONDICIONES</Text><Text style={s.value}>{model.condiciones}</Text></View>
          <View style={s.boxCol}><Text style={s.label}>ASESOR</Text><Text style={s.value}>{model.asesor}</Text></View>
          <View style={s.boxColLast}><Text style={s.label}>VIGENCIA</Text><Text style={s.value}>{model.vigencia}</Text></View>
        </View>

        <View style={s.to}>
          <Text><Text style={{ fontFamily: PDF_FONT.bold }}>Empresa: </Text>{model.empresa}</Text>
          {model.atencion ? <Text><Text style={{ fontFamily: PDF_FONT.bold }}>Atención: </Text>{model.atencion}</Text> : null}
        </View>

        {/* Encabezado de tabla fijo: se repite en cada pagina. */}
        <View style={s.th} fixed>
          <Cell w={W.te}>{COLUMN_HEADERS[0]}</Cell>
          <Cell w={W.name}>{COLUMN_HEADERS[1]}</Cell>
          <Cell w={W.cant}>{COLUMN_HEADERS[2]}</Cell>
          <Cell w={W.cur}>{COLUMN_HEADERS[3]}</Cell>
          <Cell w={W.up} right>{COLUMN_HEADERS[4]}</Cell>
          <Cell w={W.price} right>{COLUMN_HEADERS[5]}</Cell>
        </View>
        {model.rows.map((r, i) => (
          <View key={i} style={s.tr} wrap={false}>
            <Cell w={W.te}>{r.te}</Cell>
            <Cell w={W.name}>
              <Text style={{ fontFamily: PDF_FONT.bold }}>{r.nombre}</Text>
              {r.descripcion ? <Text style={s.desc}>{r.descripcion}</Text> : null}
            </Cell>
            <Cell w={W.cant}>{r.cant}</Cell>
            <Cell w={W.cur}>{r.currency}</Cell>
            <Cell w={W.up} right>{r.uPrice}</Cell>
            <Cell w={W.price} right>{r.price}</Cell>
          </View>
        ))}

        <View style={s.totals} wrap={false}>
          {model.totals.map((t) => (
            <View key={t.currency} style={s.totalRow}>
              <Text>TOTAL {t.currency}</Text>
              <Text>{t.amount}</Text>
            </View>
          ))}
        </View>

        {model.minimumPurchase ? (
          <View style={s.band} wrap={false}>
            <Text>Minimum purchase: {model.minimumPurchase}</Text>
          </View>
        ) : null}

        <View style={s.footer} wrap={false}>
          {model.footer.map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
        </View>

        <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  );
}
