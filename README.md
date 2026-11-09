# Mi Caja C$ para Windows

Empaquetado local con Electron. El instalador se genera en `outputs/instalador-windows`.

Esta es una **versión piloto**. El instalador ofrece español, inglés y portugués. Durante la primera instalación se elige el país y la moneda. La moneda queda fija después de registrar ventas para evitar mezclar importes.

En una instalación nueva, cada tienda registra su propio negocio, nombre, usuario y contraseña de administrador. No se incluyen usuarios, ventas ni productos de otras tiendas. Los datos se guardan localmente por defecto; la conexión en la nube es opcional y crea un espacio separado para cada negocio.

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

## Datos locales y nube opcional

Mi Caja C$ guarda primero cada operación en la computadora para poder vender sin internet. Si el negocio vincula una cuenta en la nube, sincroniza productos, existencias y ventas entre equipos. El catálogo se comparte entre los miembros del negocio; cada cajero ve solo sus ventas y el administrador puede revisar todas. Los negocios que no activen la nube usan el modo local.

Las cuentas de nube se administran con Supabase Auth. Cada tienda vincula su propia cuenta cuando necesita sincronizar varios equipos; las tiendas no comparten catálogo ni ventas. Para vender sin conexión y sincronizar después, cada empleado usa el mismo nombre de usuario en su cuenta local y de nube. Las contraseñas locales se protegen con PBKDF2; las contraseñas de nube solo las gestiona Supabase Auth. Consulta `CLOUD_SETUP.md` para los pasos de conexión.

