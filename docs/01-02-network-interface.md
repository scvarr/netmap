# 01.2 NetworkInterface — граница L1 и сетевых уровней

## Статус

Согласованная базовая модель сетевого интерфейса. Она определяет идентичность интерфейса, его физическую реализацию и зависимость от других интерфейсов, но не фиксирует модель L2/L3-протоколов.

## Назначение

`NetworkInterface` — логическая точка, через которую сетевой стек, коммутатор, маршрутизатор, firewall или другой сетевой механизм принимает, передаёт или связывает сетевые данные.

`NetworkInterface` принципиально отличается от `ConnectionPoint`:

```text
ConnectionPoint   физическая точка соединения
NetworkInterface  логическая точка сетевой обработки
```

Пассивный объект может иметь `ConnectionPoint` и не иметь ни одного `NetworkInterface`. Например патч-панель, розетка или пассивная муфта.

Активный физический порт обычно имеет обе сущности:

```text
PhysicalObject SW01

ConnectionPoint CP-101
    alias.display = "Gi1/0/1 connector"

NetworkInterface NI-501
    alias.display = "Gi1/0/1"

NI-501 --physically bound to--> CP-101:1
```

Это разделение позволяет не смешивать кабельную топологию с L2/L3-состоянием устройства.

## Минимальная сущность

Концептуально:

```text
NetworkInterface
    id
    owner_entity_id
```

`id` стабилен и не зависит от имени интерфейса.

`owner_entity_id` указывает сущность, которой принадлежит интерфейс. На текущем физическом уровне владельцем обычно является `PhysicalObject`, но модель намеренно не ограничивает владельца только физическими объектами. В дальнейшем владельцем может оказаться VM, namespace, virtual router, software bridge или другая логическая сущность.

Конкретный способ реализации гетерогенной ссылки `owner_entity_id` в БД пока не фиксируется.

Текущий backend storage materialize только typed relation
`NetworkInterface -> PhysicalObject` через
`NetworkInterfacePhysicalOwner`. Отсутствие этой записи означает, что owner fact
пока неизвестен. Это implementation subset не сужает conceptual owner model:
будущие VM, namespace и software owners по-прежнему допустимы отдельными typed
расширениями.

Человекочитаемое имя остаётся metadata:

```text
alias.display = "Ethernet1/1"
alias.short = "Eth1/1"
```

Текущий public write subset materialize `alias.display` для
`NetworkInterface`. Alias влияет только на presentation label и не изменяет
stable interface ID, owner relation или forwarding semantics.

## Физическая привязка

Связь `NetworkInterface` с L1 задаётся явно и не выводится из совпадения имён.

Концептуально:

```text
InterfacePhysicalBinding
    interface_id
    point_id
    point_member
```

Одна запись означает, что `NetworkInterface` непосредственно реализован через конкретный member физической `ConnectionPoint`.

Для обычной атомарной точки:

```text
NI-1 -> CP-1:1
```

Если один логический интерфейс использует несколько физических lanes или несколько коннекторов, допускается несколько binding:

```text
NI-1 -> CP-A:1
NI-1 -> CP-A:2
NI-1 -> CP-A:3
NI-1 -> CP-A:4
```

или:

```text
NI-1 -> CP-TX:1
NI-1 -> CP-RX:1
```

Backend не обязан знать, является ли это duplex fiber, MPO, lane-based PHY или другой технологией. Эта семантика может храниться отдельными фактами/metadata, если она нужна пользователю или адаптеру.

## Инварианты физической привязки

Для canonical state:

- `point_member` должен существовать в диапазоне `1..ConnectionPoint.cardinality`;
- одна пара `(ConnectionPoint, member)` не должна иметь более одного **непосредственного** `InterfacePhysicalBinding` одновременно;
- один `NetworkInterface` может иметь несколько физических binding;
- `NetworkInterface` может не иметь физического binding вообще;
- отсутствие binding не делает интерфейс неполноценным или ошибочным;
- binding описывает физическую реализацию и сам по себе не означает `link up`, L2 adjacency или возможность передачи трафика.

Если несколько логических интерфейсов используют один физический порт, они должны выражать это через отношения между `NetworkInterface`, а не все непосредственно привязываться к одному и тому же `ConnectionPoint` member.

Например:

```text
eth0.100
    -> realized over eth0
        -> physically bound to CP-1:1
```

а не:

```text
eth0     -> CP-1:1
eth0.100 -> CP-1:1
```

## Вложенные и составные интерфейсы

Для зависимости одного интерфейса от другого вводится одна базовая направленная связь:

```text
NetworkInterfaceRealization
    upper_interface_id
    lower_interface_id
```

Она означает:

> верхний `NetworkInterface` реализован поверх нижнего `NetworkInterface`.

Связь задаёт зависимость/слой реализации, но намеренно не кодирует протокольное поведение.

### Subinterface

```text
eth0.100
    |
    | realized over
    v
eth0
    |
    | physical binding
    v
CP-1:1
```

То, что между `eth0.100` и `eth0` применяется 802.1Q tag 100, является L2-фактом и не должно выводиться из имени `.100` или из типа интерфейса.

### LAG / bond

```text
Port-Channel10
    |    |     v  v
Eth1  Eth2
 |     |
 v     v
CP1   CP2
```

Один верхний интерфейс может иметь несколько нижних интерфейсов.

Базовая модель фиксирует только зависимость. Правила выбора member, hashing, LACP state и operational membership относятся к L2/состоянию и будут определены отдельно.

### Несколько верхних интерфейсов

Один нижний интерфейс может быть основой для нескольких верхних:

```text
        eth0.100
       /
eth0 <
               eth0.200
```

Это обычная ситуация и не нарушает модель.

## Инварианты realization graph

`NetworkInterfaceRealization` формирует граф слоёв реализации, а не сетевую топологию между устройствами.

На текущем уровне фиксируются правила:

- `upper_interface_id != lower_interface_id`;
- отношение направлено от более абстрактного/верхнего интерфейса к его реализации;
- один upper может иметь несколько lower;
- один lower может использоваться несколькими upper;
- realization graph не должен содержать циклов;
- наличие нескольких lower не означает автоматически broadcast, replication или использование всех путей одновременно.

Последний пункт принципиален: `NetworkInterfaceRealization` отвечает на вопрос **из чего реализован интерфейс**, но не заменяет модель forwarding behavior.

## Интерфейсы без физической реализации

Модель не требует, чтобы цепочка `NetworkInterfaceRealization` обязательно заканчивалась `ConnectionPoint`.

### Loopback

```text
Loopback0
```

не имеет физического binding.

### SVI

```text
Vlan100
```

может не иметь физического binding и не иметь нижнего `NetworkInterface`. Его связь с L2 forwarding domain будет задаваться в L2-модели.

### Tunnel

Туннельный интерфейс также не обязан иметь статическую привязку к конкретному физическому интерфейсу. Его underlay path может определяться маршрутизацией динамически во время трассировки.

Таким образом отсутствие физической реализации является нормальным состоянием модели, а не исключением.

## Пример с SFP

Физическая композиция и логическое владение могут расходиться.

Например:

```text
PhysicalObject SW01
└── PhysicalObject SFP-17
    └── ConnectionPoint LINE
```

Логический интерфейс при этом принадлежит коммутатору:

```text
NetworkInterface Ethernet1/17
owner = SW01
```

а физически реализован через точку дочернего SFP:

```text
Ethernet1/17 -> SFP-17/LINE:1
```

Нет требования, чтобы владелец `NetworkInterface` совпадал с владельцем `ConnectionPoint`.

Это позволяет независимо заменять SFP, не меняя идентичность логического интерфейса устройства.

## Где заканчивается NetworkInterface

В `NetworkInterface` не следует складывать факты других уровней только потому, что они относятся к интерфейсу.

### Не metadata, если участвует в сетевой логике

Следующие данные должны в будущем иметь структурированную модель:

- MAC address и его назначение;
- VLAN membership / tagging;
- LACP/bond state;
- bridge membership;
- IP address/prefix assignment;
- VRF membership;
- routing attributes;
- firewall zone;
- tunnel endpoints;
- administrative/operational state, если он используется при вычислении доступности.

Они могут импортироваться из metadata на раннем прототипе, но canonical backend не должен строить сетевую семантику путём разбора произвольных metadata.

### Metadata

Metadata подходит для человекочитаемого и описательного контекста:

```text
alias.display
alias.short
description
vendor_identifier
inventory_note
```

`class = loopback`, `class = lag`, `class = subinterface` также может существовать как удобная классификация, но алгоритм трассировки не должен зависеть только от этой строки. Истиной являются структурированные отношения и факты соответствующего уровня.

## Переход от L1 к NetworkInterface

Трассировка от логического интерфейса к физике выполняется в два этапа.

Для непосредственного интерфейса:

```text
NetworkInterface
    -> InterfacePhysicalBinding
        -> (ConnectionPoint, member)
            -> ConnectionMember
                -> ... L1 graph
```

Для составного интерфейса:

```text
NetworkInterface
    -> NetworkInterfaceRealization
        -> lower NetworkInterface
            -> ...
                -> InterfacePhysicalBinding
                    -> L1 graph
```

Результатом могут быть несколько физических ветвей.

Например LAG может раскрыться до двух физических портов. Это ещё не означает, что один конкретный пакет одновременно пройдёт обе ветви. Выбор фактического forwarding path является задачей L2/L3 trace.

## Обратная трассировка

Связь должна индексироваться и в обратную сторону:

```text
(ConnectionPoint, member)
    -> InterfacePhysicalBinding
        -> NetworkInterface
```

Это позволяет по найденному физическому концу определить активный сетевой интерфейс и далее перейти в L2-проекцию.

Для пассивной точки такого binding просто нет, и L1 trace продолжается по физическим Connection.

## Примеры

### Патч-панель

```text
PhysicalObject PP01
└── ConnectionPoint 17-front
└── ConnectionPoint 17-rear
```

`NetworkInterface` отсутствует.

### Физический Ethernet-порт

```text
PhysicalObject SW01
└── ConnectionPoint Gi1/0/17

NetworkInterface Gi1/0/17
    -> CP Gi1/0/17:1
```

### VLAN subinterface

```text
NetworkInterface eth0.100
    -> NetworkInterface eth0
        -> CP NIC1:1
```

### LAG

```text
NetworkInterface bond0
    -> NetworkInterface eno1 -> CP NIC1:1
    -> NetworkInterface eno2 -> CP NIC2:1
```

### SVI

```text
NetworkInterface Vlan120
    no physical binding
```

L2-модель позднее свяжет его с соответствующим L2 forwarding domain.

## Обновлённое концептуальное ядро

После добавления `NetworkInterface` базовый граф выглядит так:

```text
Location
    ^
    |
PhysicalObject
    ^
    |
ConnectionPoint <---- InterfacePhysicalBinding ---- NetworkInterface
    |                                                |
    |                                                |
Connection / ConnectionMember             NetworkInterfaceRealization
                                                     |
                                                     v
                                              NetworkInterface
```

`ConnectionPoint/ConnectionMember` образуют физическую топологию.

`NetworkInterfaceRealization` образует независимый граф логической реализации интерфейсов.

`InterfacePhysicalBinding` является мостом между этими двумя графами.

## Что намеренно не решаем здесь

- VLAN и L2 forwarding domain;
- access/trunk semantics;
- bridge forwarding;
- STP;
- LACP operational state и hashing;
- MAC/FDB;
- IP addressing;
- VRF;
- routing;
- firewall policy;
- tunnel underlay resolution;
- модель виртуальных/программных владельцев интерфейсов;
- temporal state и provenance.

Эти вопросы не требуют изменения базового разделения `ConnectionPoint` / `NetworkInterface`.

## Следующая ветка

Следующий слой — L2. В нём требуется определить как минимум:

1. L2 forwarding domain без предположения, что одинаковый VLAN ID глобально означает одну сеть;
2. привязку `NetworkInterface` к L2 domain;
3. tagged/untagged encapsulation;
4. forwarding через bridge/switch;
5. LAG как operational forwarding construct;
6. MAC/FDB как наблюдаемое состояние, а не каноническую физическую топологию.
