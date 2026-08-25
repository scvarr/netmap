# 01.3.1 L2Binding и Encapsulation

## Статус

Согласованная минимальная модель L2 attachment и представления Ethernet frame на границе `NetworkInterface`.

Эта заметка детализирует [[01-03-l2|01.3 L2 — forwarding model]].

Цель модели — одинаково описывать access, trunk, native VLAN, VLAN translation, push/pop и stacked encapsulation без специальных фундаментальных классов для каждого режима.

## Разделение attachment и boundary rules

`L2Binding` не хранит VLAN ID и не описывает конкретное wire representation.

Он фиксирует только attachment:

```text
L2Binding
    id
    interface_id
    forwarding_context_id
```

Смысл:

```text
NetworkInterface
        |
        | L2Binding
        v
L2ForwardingContext
```

Внешнее представление frame описывается отдельными правилами:

```text
L2IngressRule
    id
    binding_id
    match

L2EgressRule
    id
    binding_id
    emit
```

Это разделение принципиально.

Один attachment может принимать несколько внешних представлений, но иметь одно нормализованное представление на egress.

Пример:

```text
untagged --------\
                  > Context A
tag 100 --------/
                  |
                  +---- egress tag 100
```

Не требуется создавать два `L2Binding` между одним интерфейсом и одним context.

## Уникальность L2Binding

Для canonical state фиксируется:

```text
unique(interface_id, forwarding_context_id)
```

То есть одна пара `NetworkInterface` и `L2ForwardingContext` имеет максимум один непосредственный `L2Binding`.

Разные L2-context на одном trunk являются разными bindings:

```text
Gi1/0/48 -> Context A
Gi1/0/48 -> Context B
Gi1/0/48 -> Context C
```

Но несколько способов ingress в один `Context A` являются rules одного binding.

## EncapsulationStack

Конкретное представление Ethernet frame на внешней границе описывается value object:

```text
EncapsulationStack
    labels[]
```

Labels упорядочены от внешнего к внутреннему.

Примеры:

```text
[]
```

означает untagged Ethernet frame.

```text
[dot1q:100]
```

означает один 802.1Q-like label с идентификатором 100.

```text
[dot1ad:500, dot1q:100]
```

означает stacked representation с внешним label 500 и внутренним label 100.

Термины `dot1q` и `dot1ad` здесь являются значениями namespace/kind label, а не отдельными классами сущностей.

## EncapsulationLabel

Минимально label должен позволять выразить:

```text
EncapsulationLabel
    kind
    value
```

Например:

```text
kind  = dot1q
value = 100
```

или:

```text
kind  = dot1ad
value = 500
```

Дополнительные поля не зашиваются заранее.

Если в будущем PCP, DEI или иные bits окажутся необходимы именно для forwarding semantics, модель label может быть расширена.

Описание, QoS-классификация и прочие данные, которые не участвуют в L2 reachability, не должны автоматически становиться частью идентичности `EncapsulationStack`.

## EncapsulationStack не имеет глобальной сетевой идентичности

Stack является значением на конкретной границе.

Следовательно:

```text
[dot1q:100] на SW1/Gi48
```

и:

```text
[dot1q:100] на SW2/Gi48
```

не являются одной L2-сетью сами по себе.

Stack можно сравнивать как значение при физической передаче frame, но нельзя использовать вместо `L2ForwardingContext` или `L2ReachabilityDomain`.

## Untagged и internal — разные состояния

Пустой stack:

```text
[]
```

означает:

> Ethernet frame существует на внешней границе интерфейса без encapsulation labels.

Это обычный untagged frame.

Internal attachment имеет другую семантику:

```text
NetworkInterface SVI
        |
        | L2Binding
        v
L2ForwardingContext
```

У него вообще нет wire representation.

Поэтому:

```text
untagged != internal
```

Нельзя использовать `EncapsulationStack([])` для обозначения SVI или другой внутренней attachment.

## L2IngressRule

Ingress rule определяет, какое входное wire representation соответствует binding.

Концептуально:

```text
L2IngressRule
    id
    binding_id
    match
```

На минимальном уровне `match` должен уметь выразить точное совпадение `EncapsulationStack`.

Пример:

```text
binding = Gi1/0/48 -> Context A
match   = [dot1q:100]
```

означает:

```text
frame приходит на Gi1/0/48
    |
stack == [dot1q:100]
    |
    v
Context A
```

## EncapsulationMatch

`EncapsulationMatch` отделяется от concrete `EncapsulationStack`, потому что в будущем ingress rule может быть шире точного значения.

Например могут понадобиться:

```text
range
wildcard
несколько допустимых label values
vendor-specific predicate
```

Но эти операции пока не являются частью минимального ядра.

Первый обязательный оператор:

```text
exact(stack)
```

Этого достаточно для нормализованного описания access, trunk, native VLAN, translation и QinQ.

## Несколько ingress rules

Один `L2Binding` может иметь несколько ingress rules.

Например устройство может нормализовать оба входных представления в один context:

```text
Gi1/0/1 -> Context A

Ingress:
    exact([])            -> Context A
    exact([dot1q:100])   -> Context A
```

Сам attachment остаётся один.

Это также позволяет адаптеру нормализовать vendor-specific configuration до простых semantic rules.

## Однозначность ingress

Для одного конкретного входного состояния:

```text
(NetworkInterface, concrete EncapsulationStack)
```

effective canonical model должен позволять определить не более одного целевого `L2Binding`.

Если несколько effective ingress rules одного интерфейса одновременно совпадают с одним concrete stack и их приоритет невозможно разрешить, состояние считается неоднозначным.

Backend не должен молча выбирать произвольный context.

Возможные результаты анализа:

```text
resolved
unmatched
ambiguous
unknown
```

Точная модель статусов может быть определена позднее.

## Vendor rule priority

Некоторые реальные конфигурации могут иметь пересекающиеся правила и собственный порядок приоритетов.

Canonical semantic layer не обязан копировать vendor CLI один в один.

Адаптер может:

1. прочитать исходные rules;
2. применить известную vendor semantics;
3. нормализовать результат до непротиворечивых effective rules;
4. сохранить исходную конфигурацию/provenance отдельно.

Если адаптер не способен надёжно разрешить приоритет, он должен сохранить неопределённость, а не угадывать.

## L2EgressRule

Egress rule определяет concrete representation frame при выходе из context через interface.

Концептуально:

```text
L2EgressRule
    id
    binding_id
    emit
```

`emit` является concrete `EncapsulationStack`.

Пример:

```text
binding = Gi1/0/48 -> Context A
emit    = [dot1q:100]
```

означает:

```text
Context A
    |
egress Gi1/0/48
    |
    v
frame on wire = [dot1q:100]
```

## Нормальная egress-однозначность

Для обычного forwarding одного binding достаточно одного effective egress encoding.

Если одна и та же frame должна реплицироваться на несколько выходов, это выражается выбором нескольких `NetworkInterface`/`L2Binding` на уровне forwarding decision, а не несколькими encodings одного binding.

Специальные функции вроде mirroring не являются обычным L2 forwarding и могут моделироваться отдельно.

## Отсутствующая сторона

Модель допускает, что binding имеет ingress rules, но не имеет egress rule, или наоборот.

Это позволяет описывать направленные/ограниченные конструкции и частично известное состояние.

Однако отсутствие rule и подтверждённый запрет — не всегда одно и то же.

При работе с неполными источниками NetMap должен учитывать provenance/completeness данных и уметь вернуть `unknown`, а не автоматически считать отсутствующий факт запретом.

## Access

Access-подобная конфигурация:

```text
L2Binding:
    Gi1/0/1 -> Context A

Ingress:
    exact([])

Egress:
    emit []
```

То есть untagged frame входит и выходит untagged.

Никакого специального фундаментального `access_port` не требуется.

## Trunk

Для trunk создаются независимые bindings:

```text
Gi1/0/48 -> Context A
    ingress exact([dot1q:100])
    egress  emit([dot1q:100])

Gi1/0/48 -> Context B
    ingress exact([dot1q:200])
    egress  emit([dot1q:200])
```

`trunk` является удобным производным описанием набора таких bindings.

## Native VLAN

Native-VLAN-подобное поведение:

```text
Gi1/0/48 -> Context A
    ingress exact([])
    egress  emit([])

Gi1/0/48 -> Context B
    ingress exact([dot1q:200])
    egress  emit([dot1q:200])
```

Отдельная сущность `NativeVlan` не требуется.

## VLAN translation

Translation естественно выражается асимметрией ingress/egress разных boundaries.

Например локальный `Context X`:

```text
port A -> Context X
    ingress exact([dot1q:100])
    egress  emit([dot1q:100])

port B -> Context X
    ingress exact([dot1q:200])
    egress  emit([dot1q:200])
```

Frame:

```text
port A [100]
    |
Context X
    |
port B [200]
```

Внутри context нет необходимости помнить, что ingress label был 100.

Boundary самостоятельно кодирует frame в representation, требуемый на egress.

## Push / pop

Та же модель описывает добавление или удаление label.

### Untagged -> tagged

```text
customer-port -> Context X
    ingress exact([])
    egress  emit([])

uplink -> Context X
    ingress exact([dot1q:100])
    egress  emit([dot1q:100])
```

При forwarding от customer-port к uplink результатом становится tag 100.

### Tagged -> untagged

В обратном направлении тот же набор bindings естественно снимает tag на customer-port.

Отдельной операции `push_vlan` или `pop_vlan` в canonical topology не требуется: операция выводится из разницы representations на ingress и egress boundaries.

## QinQ / stacked labels

Stacked encapsulation не требует новой топологической сущности.

Например:

```text
uplink -> Context X

Ingress:
    exact([dot1ad:500, dot1q:100])

Egress:
    emit([dot1ad:500, dot1q:100])
```

Другой интерфейс того же context может использовать:

```text
[dot1q:100]
```

или:

```text
[]
```

Если реальное оборудование выполняет такую нормализацию.

Трассировщик просто применяет rules соответствующих boundaries.

### Transport diagnostics поверх существующей semantics

Для transport networks этот же `EncapsulationStack` должен быть источником
объяснимого trace/presentation: пользователь видит не только «VLAN 120 проходит
через устройство», а переходы `untagged -> C-VLAN 120 -> push S-VLAN 3000 ->
preserve -> pop S-VLAN -> C-VLAN 120 -> untagged` там, где они доказаны.
Это не создаёт вторую QinQ-модель и не меняет canonical rules `ingress match` /
`egress emit`.

Vendor terms (`QinQ`, `dot1q-tunnel`, `service-port`, VLAN stacking,
translation/rewrite и другие) не являются canonical semantics. Future adapters
нормализуют известные vendor facts в существующие rules и сохраняют исходное
provenance. Если переход не доказан или ingress state несовместим с downstream
expectation, trace обязан показать `UNKNOWN`/conflict, а не изобрести missing
transformation или preferred path.

## Почему не хранить transform program

Можно было бы описывать интерфейс операциями:

```text
push 500
pop
replace 100 -> 200
```

Но для базовой topology это создаёт лишнее состояние и vendor-подобную процедурную модель.

Для NetMap важнее semantic result:

```text
какое representation принимается
какое representation выпускается
к какому forwarding context оно относится
```

Поэтому canonical модель хранит declarative ingress match и egress emit.

Процедурные действия могут сохраняться как provenance/debug information адаптера, если это понадобится.

## Физическая передача

При прохождении через пассивный L1 path wire representation не меняется.

Концептуально:

```text
Interface A
egress [dot1q:100]
        |
        | passive L1 path
        v
Interface B
ingress [dot1q:100]
```

То есть concrete `EncapsulationStack`, сформированный egress rule на одной активной границе, становится входным concrete stack на следующей активной границе.

Пассивные `PhysicalObject`, `ConnectionPoint` и `ConnectionMember` не интерпретируют и не изменяют L2 encapsulation.

## L2 trace transition

Для внешнего ingress:

```text
(NetworkInterface, concrete stack)
        |
        | match L2IngressRule
        v
L2Binding
        |
        v
L2ForwardingContext
```

Для egress:

```text
L2ForwardingContext
        |
        | choose forwarding egress
        v
L2Binding
        |
        | L2EgressRule
        v
(NetworkInterface, concrete stack)
```

Далее physical binding переводит trace в L1 path.

## Internal transition

Для internal attachment wire stack отсутствует:

```text
NetworkInterface
        |
        | internal L2Binding
        v
L2ForwardingContext
```

Такой переход не должен искусственно создавать `EncapsulationStack([])`.

Это особенно важно для SVI, software bridge interfaces и дальнейшего перехода L2 -> L3.

## Configured и effective rules

NetMap может знать:

```text
configured rules
```

и отдельно:

```text
effective rules
```

Например administrative state, STP, LACP или vendor runtime state может сделать configured binding неиспользуемым для текущего forwarding.

`L2IngressRule`/`L2EgressRule` описывают semantic mapping, но факт возможности использовать binding в конкретный момент определяется также operational state.

## Provenance

Каждый импортированный rule должен быть способен ссылаться на источник и время наблюдения.

Например:

```text
source = switch-adapter
observed_at = ...
```

Если canonical rule является результатом нормализации нескольких vendor-specific строк конфигурации, provenance должен позволять восстановить, из каких исходных данных он был получен.

## Инварианты

1. `L2Binding` связывает ровно один `NetworkInterface` с одним `L2ForwardingContext`.
2. Для пары `(interface_id, forwarding_context_id)` существует максимум один canonical `L2Binding`.
3. Ingress и egress rules не являются частью идентичности `L2Binding`.
4. Один binding может иметь несколько ingress rules.
5. Обычный effective egress binding имеет не более одного concrete egress encoding.
6. `EncapsulationStack` является ordered value object, а не глобальной сетевой сущностью.
7. Labels в stack упорядочены outer -> inner.
8. `EncapsulationStack([])` означает untagged Ethernet frame.
9. Internal attachment не имеет wire representation и не равен `EncapsulationStack([])`.
10. Минимальный ingress matcher — `exact(EncapsulationStack)`.
11. Concrete ingress state одного interface не должен молча разрешаться в несколько contexts.
12. VLAN translation выражается различием representations на разных bindings одного forwarding context.
13. Push/pop являются производным результатом перехода между bindings и не требуют обязательной процедурной сущности.
14. Пассивный L1 path не изменяет concrete encapsulation stack.
15. `access`, `trunk`, `native`, `QinQ` и `translation` являются производными представлениями общих primitives.

## Открытые вопросы

Следующими отдельными ветками остаются:

- нужен ли canonical matcher сложнее `exact`, или ranges/wildcards должны всегда нормализоваться адаптерами;
- нужна ли явная priority model для ingress rules;
- какие дополнительные label fields реально участвуют в forwarding;
- как LAG/LACP влияет на выбор физического egress;
- как STP state привязывается к context/binding;
- как представить overlays, где между L2 boundaries находится L3 underlay.

Эти вопросы не должны расширять базовое ядро без реального сценария, который невозможно выразить текущими primitives.
