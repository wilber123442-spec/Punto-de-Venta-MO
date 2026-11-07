# Preparación para la nube

## Decisión de arquitectura

La aplicación debe combinar Supabase con una base local: cuando hay conexión sincroniza con la nube; sin conexión permite vender y deja las operaciones pendientes en el equipo. Cada fila de negocio lleva `business_id`, y las políticas RLS de la migración limitan la lectura a los miembros del negocio. Esto permite comercializar el POS como servicio sin mezclar datos entre clientes.

## Estado actual

- `supabase/migrations/0001_cloud_multitenant.sql` prepara tablas iniciales, autenticación basada en Supabase Auth y políticas de acceso por negocio.
- La aplicación de escritorio todavía no consume estas tablas ni sincroniza con Supabase.
- El inicio de sesión que está en la versión actual es local y guarda contraseñas legibles en `localStorage`. No uses esa versión con cuentas ni datos reales de clientes.
- No se ha creado ni configurado un proyecto Supabase, por lo que no hay datos en la nube.

## Pasos para habilitar la nube

1. Crear un proyecto Supabase bajo la cuenta comercial del propietario del producto y conservar acceso de recuperación.
2. Ejecutar la migración SQL de este directorio en ese proyecto. Revisar las políticas con cuentas de dos negocios antes de abrirlo a clientes.
3. Implementar el inicio de sesión con Supabase Auth. Para mantener el usuario corto del cajero, crear un servicio de servidor que resuelva `negocio + usuario` a una cuenta Auth. No simularlo en el cliente ni guardar contraseñas propias.
4. Crear cajeros mediante una función de servidor autenticada que compruebe el rol de administrador. La clave `service_role` solo vive como secreto del servidor y nunca se empaqueta en el instalador.
5. Migrar productos, ventas, ajustes e inventario a tablas locales con identificadores UUID. Añadir una cola local de sincronización, reintentos y resolución de conflictos. Las ventas deben usar IDs estables para que reintentar una subida no duplique cobros.
6. Migrar los datos locales existentes después de iniciar sesión y asignarlos al negocio correcto. No subirlos antes de validar a qué negocio pertenecen.
7. Probar el aislamiento con dos negocios y roles distintos, y probar trabajo desconectado/reconexión antes de publicar una versión.

La dirección del proyecto y la clave pública `anon`/publishable se pueden configurar en el cliente al implementar la integración; RLS debe estar activada y revisada. Nunca incluir secretos de servidor en archivos HTML, el instalador, GitHub Releases ni respaldos distribuidos.
