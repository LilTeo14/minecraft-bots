# Guía de Comandos para Bots de Minecraft

Esta guía detalla todos los mensajes y comandos que puedes enviarle a los bots en el juego a través del chat local o por mensaje privado (`/msg <NombreBot> <comando>`).

---

## 🛠️ Comandos Generales (Todos los bots)

Estos comandos son válidos para cualquier bot sin importar su profesión actual:

| Comando | Acción |
| :--- | :--- |
| `habla` | Activa el modo hablado (el bot te enviará mensajes informando sus acciones). |
| `silencio` | Activa el modo silencio (el bot trabajará en silencio sin enviarte mensajes). |
| `ven` | El bot te enviará una solicitud de teletransporte (`/tpa`). |
| `vuelve` | El bot regresará a su posición anterior usando el comando `/back`. |
| `dame` | El bot caminará hacia ti y te soltará todo su inventario en el suelo. |
| `objetos` | Envía un mensaje listando todos los ítems actuales en su inventario. |
| `guarda` | Inicia inmediatamente el proceso de depósito de ítems en sus respectivos cofres. |
| `cultivador` | Asigna la profesión de **Granjero** al bot (permanece inactivo hasta recibir la orden `trabaja`). |
| `talador` | Asigna la profesión de **Talador** al bot (permanece inactivo hasta recibir la orden `trabaja`). |
| `minero` | Asigna la profesión de **Minero** al bot (permanece inactivo hasta recibir la orden `trabaja`). |
| `criador` | Asigna la profesión de **Criador** al bot (permanece inactivo hasta recibir la orden `trabaja`). |
| `trabaja` | Ordena al bot iniciar o reanudar el trabajo correspondiente a su profesión asignada. |
| `ayuda` o `help` | Muestra la lista de ayuda general en el chat. |
| `ayuda <granjero \| talador \| minero \| criador>` | Muestra los comandos específicos de la profesión indicada. |

---

## 🔄 Flujo de Profesiones y Trabajo

Para controlar a los bots debes seguir estos dos pasos:

1. **Asignar la Profesión:** Envía el comando `cultivador`, `talador` o `minero`. El bot cambiará de profesión en caliente, guardará su nueva profesión en la configuración [bots_config.json](file:///c:/Users/Mateo/OneDrive%20-%20Universidad%20T%C3%A9cnica%20Federico%20Santa%20Mar%C3%ADa/minecraft-bots/bots_config.json) y se detendrá (quedará inactivo).
2. **Ordenar Trabajar:** Envía el comando `trabaja`. El bot comenzará la tarea asociada a su profesión.

*Nota: Si el bot es reiniciado, recordará su profesión y si estaba trabajando previamente, reanudará sus tareas automáticamente.*

---

## 🌾 Granjero (Farmer)

*Se asigna con el comando `cultivador` e inicia con `trabaja`.*

| Comando | Acción |
| :--- | :--- |
| `trabaja` o `cultiva` | Inicia el cultivo automático de campos (cosecha y resiembra en un radio de 64 bloques). |
| `para` | Detiene el cultivo automático inmediatamente. |
| `cofre <tipo> <x> <y> <z>` | Configura la posición de un cofre compartido de la red (ver tipos de cofre abajo). |
| `cama <x> <y> <z>` | Va hacia la cama indicada y hace clic derecho en ella para asegurar el spawn. |

### Tipos de Cofre de Granjero:
* `papas` / `papa`
* `trigo`
* `semillas` / `semilla`
* `zanahorias` / `zanahoria`
* `leña` / `madera` *(compartido con el Leñador)*

---

## 🪓 Leñador (Lumberjack)

*Se asigna con el comando `talador` e inicia con `trabaja`.*

| Comando | Acción |
| :--- | :--- |
| `trabaja` o `tala` | Inicia la tala automática de árboles cercanos (en un radio de 32 bloques). Replantará un sapling en la base si tiene. |
| `para` | Detiene la tala automática inmediatamente. |
| `cofre <tipo> <x> <y> <z>` | Configura la posición de un cofre compartido de la red (generalmente `leña`). |
| `cama <x> <y> <z>` | Va hacia la cama indicada y hace clic derecho en ella para asegurar el spawn. |

### Depósito de Leñador:
Cuando el bot tenga **10 o más troncos** de madera y esté trabajando, se dirigirá de forma automática al cofre configurado como `leña` (o `madera`) para guardarlos junto con las manzanas y el exceso de saplings (conservando siempre 10 saplings de cada tipo en inventario para poder replantar).

---

## ⛏️ Minero (Miner)

*Se asigna con el comando `minero` e inicia con `trabaja`.*

| Comando | Acción |
| :--- | :--- |
| `trabaja` | Reanuda el ciclo de minado utilizando la última configuración de mina guardada. |
| `minar aqui <dirección>` | Inicia una excavación de túneles tipo rama partiendo de la posición actual del bot (fuerza la altura Y a -53 y marca la mina como activa). |
| `minar <x> <z> <dirección>` | Inicia una excavación de túneles tipo rama partiendo de las coordenadas X y Z (altura Y forzada a -53 y marca la mina como activa). |
| `minar <x> <y> <z> <dirección>` | Inicia la excavación partiendo de las coordenadas exactas de inicio X, Y, Z (y marca la mina como activa). |
| `para` o `detener` | Detiene el ciclo de minado automático. |
| `picotas <x> <y> <z>` | Configura la posición del cofre de picotas de repuesto del bot. |
| `ores <x> <y> <z>` | Configura la posición del cofre donde se guardarán los minerales extraídos. |
| `reabastecer` | Fuerza al bot a ir al cofre de picotas y tomar herramientas nuevas. |
| `depositar` | Fuerza al bot a ir al cofre de ores a guardar los minerales que tenga en su inventario. |
| `status` o `info` | Muestra el estado del minero (si está minando, dirección, progreso del túnel, etc.). |

*Las direcciones válidas para minar son: `norte`/`north`/`n`, `sur`/`south`/`s`, `este`/`east`/`e`, `oeste`/`west`/`w`/`o`.*

---

## 🐮 Criador (Breeder)

*Se asigna con el comando `criador` e inicia con `trabaja` o `cria`.*

| Comando | Acción |
| :--- | :--- |
| `trabaja` o `cria` | Inicia la crianza automática de animales (cows, sheep, chickens, pigs) en un radio de 32 bloques. |
| `para` | Detiene la crianza automática inmediatamente. |
| `cofre <tipo> <x> <y> <z>` | Configura la posición de un cofre compartido de la red (ver tipos de cofre abajo). |
| `cama <x> <y> <z>` | Va hacia la cama indicada y hace clic derecho en ella para asegurar el spawn. |

### Alimentación y Reabastecimiento de Criador:
El bot detecta de manera inteligente si tiene suficiente alimento en su inventario para alimentar a los animales cercanos de cada especie. Si tiene **menos de 10 unidades** de un alimento específico (por ejemplo, trigo para vacas/ovejas, semillas para gallinas, o zanahorias/papas para cerdos) y hay animales de esa especie cerca, se dirigirá automáticamente al cofre configurado de la red para retirar un stack de 64 unidades del alimento correspondiente antes de proceder a la crianza.

---

## 🗃️ Red de Almacenamiento Compartido (`sharedChests`)

Todos los cofres específicos de cultivos (`papas`, `trigo`, `semillas`, `zanahorias`) y de madera (`leña` / `madera`) se guardan de forma **global y compartida** en el archivo [bots_config.json](file:///c:/Users/Mateo/OneDrive%20-%20Universidad%20T%C3%A9cnica%20Federico%20Santa%20Mar%C3%ADa/minecraft-bots/bots_config.json).
Cualquier bot que configure uno de estos cofres actualizará la posición para toda la red de bots de forma instantánea.
