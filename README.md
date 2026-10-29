# Preventa App — Aplicación Móvil de Preventa y Pedidos

**Distribuciones Hermanos Castro del Sur Los Santos**

Aplicación Web Progresiva (**PWA**) diseñada específicamente para que los preventistas y vendedores tomen pedidos en ruta y visiten clientes en la calle, con soporte **100% offline (sin internet)** y sincronización ultrarrápida a través de Google Sheets.

---

## 🎯 ¿Qué hace realmente esta aplicación?

La **Preventa App** es la herramienta de trabajo diario del vendedor en la calle. Sus funciones reales son:

### 1. 📱 Operación 100% Offline (Local-First)
- Los preventistas recorren zonas rurales o locales comerciales sin señal telefónica ni cobertura móvil.
- La aplicación guarda toda la información en el almacenamiento local del dispositivo (`IndexedDB`, `localStorage` y `CacheStorage`).
- Al abrir la aplicación en el celular, carga de inmediato en **0 ms** sin pantallas de carga ni bloqueos.

### 2. 🔐 Control de Acceso por Vendedor
- Cada preventista ingresa con su código oficial (`3`, `4`, `5`, `9`) y contraseña registrada en Google Sheets.
- La sesión se mantiene guardada en el equipo del vendedor para que no tenga que iniciar sesión repetidamente.

### 3. ⚡ Sincronización Ultrarrápida de Ruta (Desacoplada del ERP)
- **Cero conexión al ERP desde el celular:** La app de preventa **nunca** se conecta al servidor del ERP en vivo. Esto elimina caídas, errores de conexión o tiempos de espera de 30-45 segundos.
- **Descarga desde Google Sheets en 2 a 4 segundos:** Al tocar *"Sí, actualizar mi ruta"*, la app descarga en un solo viaje consolidado (`action=snapshot_all`):
  - **Catálogo de Productos:** Códigos, descripciones, inventario disponible, precios de costo, jerarquías y porcentaje de IVA.
  - **Cartera de Clientes:** Lista de clientes asignados a su ruta con código, nombre comercial, límite de crédito, saldo actual y días de crédito.
  - **Reglas de Descuentos:** Descuentos comerciales automáticos según el producto y cliente.
  - **Códigos CABYS:** Código tributario de Hacienda (1542 registros) para facturación electrónica.
  - **Maestros de Proveedores y Categorías:** Para visualización y filtros dinámicos en los chips de la app.
  - **Fotos en Alta Definición:** Enlaces a las fotos reales de los productos almacenadas en Google Drive.

### 4. 🛒 Catálogo Interactivo y Toma de Pedidos
- **Selección de Cliente:** El vendedor selecciona el cliente que está visitando desde su cartera.
- **Visualización con Fotos:** Grid interactivo de productos con fotografía real, zoom ampliado, código y detalle del fabricante.
- **Filtros Rápidos:** Navegación por chips de Categorías y Proveedores (Nestlé, Purina, etc.) más buscador en vivo por código o nombre.
- **Cálculo Automático de Precios (₡):**
  - Aplica automáticamente el descuento comercial configurado para el cliente.
  - Calcula el subtotal, el desglose de IVA y el precio final con IVA incluido (IVAI).
- **Control de Inventario:** El vendedor puede ver si hay existencias del producto antes de agregarlo al carrito.
- **Carrito de Compras:** Sumatoria en tiempo real con detalle de unidades, desglose de impuestos y total general.

### 5. 📤 Envío Directo del Pedido
- El pedido armado se genera en texto estructurado y se envía con un solo toque vía **WhatsApp** a despacho/facturación o al cliente como comprobante.

---

## 🏗️ Flujo de Datos del Ecosistema

```
[ ERP Comercial dev.ecom.com.co ]
              │
              │  (1) Descarga controlada exclusivamente por el Administrador
              ▼
    [ Portal Administrativo ]
              │
              │  (2) Guarda instantáneas limpias y validadas
              ▼
       [ Google Sheets ] 
              │
              │  (3) Descarga de ruta en 2 a 4 segundos
              ▼
       [ Preventa App ] (PWA en el celular del vendedor)
              │
              │  (4) Toma de pedidos 100% Offline en la calle
              ▼
   [ Envío por WhatsApp a Facturación / Despacho ]
```

---

## ⚙️ Configuración y Uso

1. **Abrir la App:** Ingresa a `/preventa-app/` desde el navegador móvil (Chrome en Android o Safari en iOS).
2. **Instalar en la Pantalla de Inicio:**
   - Android: Menú del navegador > *Instalar aplicación* o *Agregar a la pantalla principal*.
   - iOS: Botón Compartir > *Agregar al inicio*.
3. **Inicio de Sesión:**
   - Ingresa tu código de vendedor (ej. `4`) y tu contraseña.
   - Pega la URL del Google Apps Script si es la primera vez en ese dispositivo.
4. **Actualizar la Ruta:**
   - Toca *"Sí, actualizar mi ruta"*. En 3 segundos tendrás todos tus productos, clientes y fotos listos para trabajar sin conexión todo el día.
