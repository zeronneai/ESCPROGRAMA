# Pruebas manuales de la fase 4

Necesitas dos cuentas: un **vendedor** (V) y un **comprador** (C). Haz las pruebas en orden; algunas usan lo que dejo la anterior.
Para probar la vigencia vencida sin esperar 15 dias, el comprador puede poner la vigencia en 1 dia en Configuracion (afecta solo cotizaciones nuevas) y esperar un dia, o usar la consulta que esta al final.

## A. Clientes y solicitud
1. **V:** Nueva solicitud. En Cliente escribe una empresa que no existe, llena Atencion y Destino de entrega, agrega una partida con referencia y envia. **Esperado:** se crea la empresa sola (sin pedir tipo, correo ni contacto) y la solicitud sale con folio COT-AAAA-NNNN.
2. **V:** Nueva solicitud y empieza a escribir el nombre de la empresa anterior. **Esperado:** aparece en el autocompletado.

## B. Cotizar, vigencia y precio elegido
3. **C:** abre la solicitud, cotiza (costo 100, MXN, 5 dias habiles, compra minima 10 cajas) y en "Donde conseguirlo" anota proveedor y link. **Esperado:** vista previa con los 5 precios; al guardar la cotizacion queda bloqueada; el proveedor aparece en el catalogo.
4. **V:** abre la solicitud. **Esperado:** ve los 5 precios, la vigencia (hasta dentro de 15 dias) y **no** ve costo, proveedor ni "Donde conseguirlo".
5. **V:** elige el Precio 2, recarga la pagina, cambia al Precio 3. **Esperado:** la eleccion se conserva y se puede cambiar.
6. **V:** descarga el PDF antes de elegir precio en una segunda partida. **Esperado:** el boton esta deshabilitado y dice "Elige el precio de la partida ...".
7. **V:** con todos los precios elegidos, captura Destino y Via (Parcel), deja el envio en "Sin envio" y revisa la vista previa (precios sin IVA). Presiona **Descargar PDF**. **Esperado:** archivo `COT-AAAA-NNNN_<cliente>.pdf` con encabezado de ESC, tabla TE / Product Name / CANT / Currency / U. Price / Price, SOLO el precio elegido, franja amarilla "Minimum purchase: 10 caja" y en el pie "Prices include shipping charges to your plant in <destino>, via Parcel". Sin destino capturado, esa linea no sale.
8. **V:** en "Envio al cliente" elige "Por todo el pedido", monto 100 (sin IVA) en una partida de 2 cajas. **Esperado:** la vista previa muestra cada caja con +50 en U. Price, Price con +100 y el total; una linea neutral "Envio incluido en precios: $100.00". Descarga: el PDF NO tiene renglon de envio ni menciona el monto, solo el costo final. Repite con "Por unidad" 50 (mismo resultado) y con "Por partida" (por unidad o total de la partida). Con una solicitud en pesos y dolares el panel exige elegir la moneda y solo cambian las partidas de esa moneda. Con varias partidas, el reparto es proporcional a su importe y el total puede diferir unos centavos del monto capturado. "Copiar tabla de precios" no cambia (5 precios, sin envio).
9. **V:** presiona **Enviado al cliente**. **Esperado:** el precio queda fijo (los botones de eleccion se desactivan). **C:** en Auditoria aparecen la eleccion, el envio y el evento `download_pdf`.

## C. Resultado
10. **V:** en la partida enviada marca **Perdida** sin motivo. **Esperado:** no deja guardar. Elige "Otro" sin texto: tampoco. Elige "Precio alto" y guarda.
11. **V:** corrige a **Ganada** con cantidad final 8. **Esperado:** se guarda. **C:** en Auditoria se ven ambos cambios con valor anterior y nuevo.
12. **C:** Estadisticas. **Esperado:** tasa de conversion, motivos de perdida y valor cotizado contra ganado por moneda.

## D. Por comprar (solo comprador)
13. **C:** menu Por comprar. **Esperado:** aparece la partida ganada con cantidad final 8, proveedor, link (se abre en otra pestana), costo y moneda.
14. **C:** marca **Comprada**. **Esperado:** queda con fecha y usuario y sale del filtro "Por comprar". Exporta a Excel.
15. Repite 3 a 11 con otra partida sin anotar proveedor ni link. **Esperado:** en Por comprar sale con "Falta definir proveedor".
16. **V:** intenta abrir `/comprador/por-comprar` y `/comprador/historial`. **Esperado:** lo regresa a su pagina.

## E. Revision por vigencia vencida
17. Con una cotizacion cuya vigencia ya vencio y sin resultado: **V** ve "Vigencia vencida" y el boton **Solicitar actualizacion**; el boton Enviado al cliente no esta disponible. **Esperado:** si la partida ya es Ganada o Perdida, no aparece el boton.
18. **V:** Solicitar actualizacion con una nota. **Esperado:** la partida pasa a "Actualizacion solicitada". **C:** recibe aviso (campana) y ve el plazo de 48 horas hábiles.
19. **C:** **Confirmar sin cambios**. **Esperado:** nace la version 2 (folio `...-R2`) con los mismos precios y 15 dias nuevos; la v1 sigue visible en "Versiones anteriores".
20. **V:** ve el aviso de version nueva, vuelve a elegir precio y marca Enviado. **Esperado:** se crea un nuevo registro de envio; el PDF sale con folio `COT-AAAA-NNNN-R2`.
21. Repite 17 y 18 y esta vez **C:** **Actualizar costo** con costo 200 y envio 20. **Esperado:** version 3 con los 5 precios recalculados con los factores vigentes; las versiones 1 y 2 no cambian.
22. **C:** Estadisticas. **Esperado:** "Actualizaciones solicitadas" y "Respuesta a actualizaciones".

## F. Aclaraciones y pausa del reloj
23. **C:** en una partida pendiente presiona **Pedir aclaracion** con una pregunta. **Esperado:** la partida pasa a "Esperando aclaracion", el reloj se marca en pausa y **V** recibe aviso.
24. **V:** abre "Aclaraciones y mensajes", responde con texto y una imagen. **Esperado:** el reloj se reanuda, la partida regresa a Pendiente, **C** recibe aviso y ve la imagen.
25. Deja pasar un tiempo con la aclaracion abierta y revisa el semaforo. **Esperado:** el tiempo restante no baja mientras esta en pausa.
26. **C:** Bitacora de la solicitud. **Esperado:** quedan registradas la solicitud y la respuesta de la aclaracion.

## G. Historial de precios (solo comprador)
27. **C:** al cotizar una partida con nombre parecido a otra ya cotizada. **Esperado:** "Cotizaciones anteriores parecidas" con fecha, costo, envio, moneda, proveedor, precio elegido y resultado; **Usar como base** precarga el formulario (y el abastecimiento) sin guardar.
28. **C:** Historial, busca por producto y luego por proveedor. **Esperado:** tabla y grafica del costo en el tiempo.

## H. Privacidad (lo mas importante)
29. **V:** revisa el PDF, la pantalla de la solicitud y "Copiar tabla de precios" (pegala en un editor; debe terminar con la nota "Precios sin IVA"). **Esperado:** en ninguno aparece costo, envio del proveedor, base, porcentaje, proveedor, link ni notas de compra.
30. **V:** intenta abrir `/api/admin/export?tipo=por_comprar`. **Esperado:** error 403.

## Consulta util para probar vigencia vencida (solo en un ambiente de pruebas)
En el SQL Editor, cambia el UUID por el de la partida (`item_id`) y ejecuta. Es una excepcion de prueba al bloqueo, **no la uses con datos reales**:
```sql
alter table public.item_quotes disable trigger item_quotes_locked;
update public.item_quotes set valid_until = now() - interval '1 day' where item_id = '00000000-0000-0000-0000-000000000000';
alter table public.item_quotes enable trigger item_quotes_locked;
```
