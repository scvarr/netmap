# 11.4 Phase C representative L1 testbed

## Назначение и граница

Этот документ — living acceptance-scenario document для Phase C из
[[plans/11-03-pre-l2-product-completion|11.3 Pre-L2 product completion]]. Он
фиксирует упрощённую real-world representative model, которую пользователь
постепенно строит в NetMap. Это не architecture spec и не inventory source.

Цель стенда — проверить truthful L1 modeling, Blueprint/PortBlock authoring,
PhysicalObject/ConnectionPoint/Cable workflows, Locations и racks, SavedMap
presentation, Regions/routes, L1 trace и понятность UI без знания внутренних
entity IDs. Если реальная схема не может быть честно выражена текущей моделью,
это Phase C finding, а не повод подменять факт фиктивной topology.

## CONFIRMED

Подтверждены только следующие факты representative model:

1. Есть упрощённая тестовая сборка этажа с рабочей цепочкой имён:
   `pc1 — o1 — pp1 — sw1`.
2. `sw1` — этажный коммутатор.
3. Из стойки 811 к `sw1` приходит uplink от оптического коммутатора.
4. От того же оптического коммутатора идёт оптическая линия в стойку 833.
5. В стойке 833 присутствует оптическая патч-панель/оптический компонент,
   описанный пользователем как «1 в 24». Точный класс и конструкция пока не
   установлены.
6. В стойке 833 находятся два Cisco-коммутатора, объединённые StackWise.
7. В стойке 833 находится сервер с двумя оптическими интерфейсами.
8. Это намеренно упрощённая representative model, а не полный production
   inventory.

## OPEN / UNKNOWN — не додумывать

Следующие facts пока неизвестны и не должны становиться canonical facts без
подтверждения:

- точная роль и тип `o1`;
- точная роль и аппаратная модель `pp1`, если они не подтверждены текущим
  repository evidence или пользователем;
- точная аппаратная модель оптического коммутатора в стойке 811;
- точное значение «1 в 24»: не называть это splitter, 24-port panel или
  другим конкретным типом без подтверждения;
- vendor/model двух Cisco-коммутаторов;
- exact StackWise physical cabling и ports;
- exact endpoints оптической линии 811 → 833;
- куда подключены два optical interfaces сервера;
- количество волокон и member semantics;
- media, connector и transceiver details.

OPEN facts не являются canonical facts и не должны использоваться для
искусственного завершения acceptance.

## Приблизительный acceptance sketch

```text
Floor:
pc1 -- o1 -- pp1 -- sw1
                    |
                    | uplink
                    |
Rack 811:           optical switch
                    |
                    | optical link
                    |
Rack 833:           optical panel/component
                    |                  ("1 in 24")
                    |                  [exact mapping OPEN]
                    |
                 +--+-----------+
                 |              |
              Cisco A       Server
                 ||          optical NIC 1
              StackWise      optical NIC 2
                 ||
              Cisco B
```

Схема показывает приблизительные отношения, но не утверждает неизвестные
соединения в Rack 833. StackWise, optical panel/component, server NICs и
оптическая линия не получают из рисунка дополнительных canonical endpoints,
портов или member mappings.

## Acceptance use в Phase C

Стенд используется постепенно и task-based:

1. Создать и проверить Locations и racks, включая этаж и стойки 811/833.
2. Создать необходимые Blueprints/Port Blocks только по реально известным
   данным; неизвестный optical component не моделировать ложным типом.
3. Materialize подтверждённые PhysicalObjects и их ConnectionPoints.
4. Построить подтверждённые physical Connections и Cable workflows.
5. Разместить подтверждённые объекты и связи на SavedMap.
6. Настроить presentation, routes и Regions, не используя presentation state
   как canonical topology truth.
7. Выполнить L1 trace на подтверждённых путях и проверить evidence/result.
8. Зафиксировать каждый gap и отделить data uncertainty от отсутствующей
   capability.

Пользовательский сценарий должен выполняться через видимые имена и обычные
UI workflows; знание UUID или других внутренних entity IDs не является
acceptance prerequisite.

## Classification of findings

Каждый найденный gap классифицируется как один из следующих типов:

- correctness;
- missing domain/authoring capability;
- UX;
- visual/style;
- performance/readiness;
- documentation/data uncertainty.

### Отдельные проверки

- StackWise не должен автоматически становиться выдуманной canonical
  сущностью.
- Неизвестный optical component не должен моделироваться ложным типом.
- Если понадобится multi-member или fiber semantics, это должно быть доказанным
  Phase C gap, а не заранее обещанной capability.
- Presentation state, включая SavedMap placement и routes, не используется как
  canonical truth.

Этот testbed не проектирует StackWise domain model, не добавляет optical/fiber
feature в roadmap заранее, не обещает multi-fiber support и не расширяет scope
до L2.
