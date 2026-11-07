# Punto de Venta MO para Windows

Empaquetado local con Electron. El instalador se genera en `outputs/instalador-windows`.

Esta es una **versión piloto**. El instalador ofrece español, inglés y portugués. Durante la primera instalación se elige el país y la moneda. La moneda queda fija después de registrar ventas para evitar mezclar importes.

Las anulaciones están disponibles para el administrador desde el historial: solicitan motivo, conservan la venta marcada como anulada, devuelven las existencias y excluyen el importe de los totales y cortes.

## Preparar dependencias

Requiere Node.js con pnpm. Instala dependencias con `pnpm install`.

## Compilar el instalador

El canal está preparado para `wilber123442-spec/punto-de-venta-mo`. Para generar el instalador local ejecuta `pnpm run dist:win`.

El instalador manual se genera en `outputs/instalador-windows`.

## Publicar una actualización

Al subir cambios a la rama `main`, GitHub Actions compila Windows, aumenta automáticamente la versión y publica una GitHub Release con el instalador. La aplicación busca esa publicación al iniciar y desde Configuración. Si encuentra una versión más nueva, la descarga y muestra **Instalar actualización**; al pulsarlo abre el instalador y cierra el POS para que Windows pueda reemplazar los archivos.

El repositorio público `wilber123442-spec/punto-de-venta-mo` debe existir y contener el proyecto para que GitHub Actions publique releases. La primera vez es necesario instalar manualmente una versión con el buscador integrado. Después, cada subida a `main` crea una nueva versión que las instalaciones existentes pueden recibir desde la aplicación.

La ubicación de datos del usuario está fuera de la carpeta de instalación y el desinstalador no la elimina.

## Datos en la nube y uso sin internet

El programa actual todavía guarda la información de forma local en la computadora. El esquema inicial de Supabase en `supabase/migrations` es una preparación: **no significa que la aplicación ya esté conectada ni que haya subido datos**. La pantalla de acceso actual también guarda las contraseñas localmente en texto legible; no se debe distribuir esta versión para manejar datos reales de clientes.

Antes de comercializar, completa la integración de autenticación en la nube, separación por negocio, sincronización local/nube y creación segura de usuarios. Consulta `CLOUD_SETUP.md`. Las contraseñas deben quedar bajo Supabase Auth, que conserva hashes; nunca se debe guardar la contraseña en tablas propias ni incluir una clave `service_role` en la aplicación.
