# Preparación para la nube

## Decisión de arquitectura

La aplicación debe combinar Supabase con una base local: cuando hay conexión sincroniza con la nube; sin conexión permite vender y deja las operaciones pendientes en el equipo. Cada fila de negocio lleva `business_id`, y las políticas RLS de la migración limitan la lectura a los miembros del negocio. Esto permite comercializar el POS como servicio sin mezclar datos entre clientes.

## Estado actual

- `supabase/migrations/0001_cloud_multitenant.sql` prepara tablas iniciales, autenticación basada en Supabase Auth y políticas de acceso por negocio.
- La aplicación de escritorio todavía no consume estas tablas ni sincroniza con Supabase.
- El inicio de sesión que está en la versión actual es local y guarda contraseñas legibles en `localStorage`. No uses esa versión con cuentas ni datos reales de clientes.
- No se ha creado ni configurado un proyecto Supabase, por lo que no hay datos en la nube.

## Pasos para habilitar la nube

1. Entra al [panel de Supabase](https://supabase.com/dashboard), crea un proyecto dentro de una organización que controles y guarda la contraseña de la base de datos en un gestor de contraseñas. Escoge una región cercana a tus clientes. La documentación oficial indica crear el proyecto desde el panel y guardar su contraseña de forma segura.
2. Cuando el proyecto esté listo, copia el **Project URL** desde **Connect** y crea/copia una **Publishable key** en **Settings → API Keys**. La aplicación puede incluir esta clave pública; nunca compartas ni empaquetes una clave **Secret**, `service_role` o la contraseña de la base de datos. La clave pública depende de RLS para limitar los datos accesibles.
3. Ejecutar las migraciones SQL de este directorio en ese proyecto. La segunda migración añade lotes con fecha de vencimiento, costos por lote y costo/utilidad de cada artículo vendido. Revisar las políticas con cuentas de dos negocios antes de abrirlo a clientes.
4. Implementar el inicio de sesión con Supabase Auth. Para mantener el usuario corto del cajero, crear un servicio de servidor que resuelva `negocio + usuario` a una cuenta Auth. No simularlo en el cliente ni guardar contraseñas propias.
5. Crear cajeros mediante una función de servidor autenticada que compruebe el rol de administrador. La clave `service_role` o **Secret** solo vive como secreto del servidor y nunca se empaqueta en el instalador.
6. Migrar productos, lotes, ventas, ajustes e inventario a tablas locales con identificadores UUID. Añadir una cola local de sincronización, reintentos y resolución de conflictos. Las ventas deben usar IDs estables para que reintentar una subida no duplique cobros.
7. Migrar los datos locales existentes después de iniciar sesión y asignarlos al negocio correcto. No subirlos antes de validar a qué negocio pertenecen.
8. Probar el aislamiento con dos negocios y roles distintos, y probar trabajo desconectado/reconexión antes de publicar una versión.

Para continuar, comparte únicamente el **Project URL** y la **Publishable key**. No envíes la contraseña de base de datos ni la clave Secret. Supabase permite obtener el URL desde Connect y las claves desde Settings → API Keys.

La dirección del proyecto y la clave pública `anon`/publishable se pueden configurar en el cliente al implementar la integración; RLS debe estar activada y revisada. Nunca incluir secretos de servidor en archivos HTML, el instalador, GitHub Releases ni respaldos distribuidos.
