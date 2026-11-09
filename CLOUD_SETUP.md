# Preparación para la nube

## Decisión de arquitectura

La aplicación usa almacenamiento local primero y sincronización opcional con Supabase. Sin internet puede seguir vendiendo localmente; al activar nube, los cambios de la sesión en la nube se sincronizan entre equipos. El catálogo se comparte dentro de cada tienda; cada cajero ve sus propias ventas y el administrador ve todas. Cada tienda mantiene sus datos aislados mediante `business_id` y políticas RLS.

Cada cliente registra su propio negocio y administrador durante su primera instalación. No se debe distribuir una instalación preparada con datos de demostración, usuarios reales, sesión iniciada o copias de respaldo. El proyecto Supabase configurado en el programa es la infraestructura compartida del servicio; las políticas separan los negocios y cada tienda crea/vincula su propia cuenta. La conexión es opcional: sin ella, los datos permanecen en la computadora.

## Estado actual

- Proyecto creado: **Mi Caja C$** (`sopebnliutlghshicyxb`), región East US (North Virginia), estado saludable.
- La contraseña de base de datos se compartió en el chat. Cámbiala desde la configuración de base de datos de Supabase y guárdala en un gestor de contraseñas. No la pongas en este repositorio, en la aplicación ni en GitHub.
- `supabase/migrations/0001_cloud_multitenant.sql` prepara negocios, miembros, productos, ventas, recibos y políticas de acceso por negocio.
- `supabase/migrations/0002_lots_costs_and_reports.sql` prepara lotes, fechas de vencimiento, costos, utilidades y anulaciones.
- `supabase/migrations/0003_business_invitations.sql` prepara invitaciones de cajeros y administradores con tokens de un solo uso.
- `supabase/MiCaja-schema.sql` reúne las tres migraciones en una sola transacción para facilitar su ejecución manual desde el SQL Editor.
- Las migraciones `0001` a `0003` se aplicaron el 8 de noviembre de 2026. Se verificaron las 10 tablas y RLS está activado en las 10.
- `supabase/migrations/0004_atomic_sale_operations.sql` instala las funciones seguras del servidor para cobros, lotes y anulaciones. Aplicada el 8 de noviembre de 2026.
- La aplicación incluye una sección opcional para que el administrador vincule la cuenta propia del negocio con Supabase Auth. La autenticación de la nube está separada del inicio local.
- `cloud-client.js` usa solo la clave **Publishable** y mantiene los tokens de sesión temporales; no guarda la contraseña de Supabase. Las cuentas locales almacenan claves derivadas con PBKDF2; las contraseñas antiguas se convierten automáticamente al abrir la aplicación.
- `cloud-setup.js` permite crear o vincular la cuenta propietaria del negocio desde **Configuración → Cuenta en la nube** y guarda la moneda seleccionada con las políticas RLS existentes.
- `supabase/migrations/0005_cashier_sales_privacy.sql` limita las ventas y artículos visibles a cada cajero; los administradores conservan acceso a todo el negocio. Aplicada el 8 de noviembre de 2026 y verificada en las políticas activas.
- `cloud-sync.js` sincroniza catálogo, lotes, ventas y anulaciones pendientes; escucha reconexión y mantiene datos locales. Las ventas se guardan primero localmente. Una cuenta local enlazada con el mismo usuario de nube puede vender sin conexión y dejar sus ventas pendientes; al recuperar internet, inicia sesión con su cuenta de nube y sincroniza. Los cajeros consultan sus propias ventas; el administrador consulta todas.

## Pasos para habilitar la nube

1. El proyecto ya está listo: `https://sopebnliutlghshicyxb.supabase.co`.
2. Las migraciones `0001` a `0003` ya están aplicadas y verificadas. No vuelvas a ejecutar `supabase/MiCaja-schema.sql`.
3. Las migraciones `0004` y `0005` ya están aplicadas. No vuelvas a ejecutarlas.
4. La aplicación ya tiene un cliente de Auth y una pantalla para vincular la cuenta administradora. La clave **Publishable** está configurada en el cliente; nunca empaquetes una clave **Secret**, `service_role` o la contraseña de base de datos.
5. Cada cajero necesita una cuenta de nube y una cuenta local con el mismo nombre de usuario para habilitar el envío de ventas creadas durante una desconexión. El administrador puede revisar el historial completo y emitir invitaciones.
6. Al habilitar nube en un negocio existente, el administrador elige confirmar la carga inicial del catálogo local. Prueba primero con productos de demostración, dos cajeros y una caja desconectada.

La nube ya está conectada y las políticas se aplicaron. Se generó un instalador de Windows para la versión piloto. Antes de distribuir a clientes, valida con datos ficticios dos cuentas de cajero, dos equipos y el flujo sin internet/con reconexión. El logo sigue guardado localmente, no se sincroniza entre dispositivos. Nunca incluyas secretos de servidor, `service_role` ni contraseñas en HTML, el instalador, GitHub Releases o respaldos.

