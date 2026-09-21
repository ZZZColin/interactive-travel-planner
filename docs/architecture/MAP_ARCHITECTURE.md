# 地图运行时架构

更新时间：2026-09-19

## 目标

地图业务保持同一套旅行规划 UI，同时允许渲染引擎、地点服务和路线服务独立组合。高德、腾讯与 Google Maps 可以同时提供渲染和数据服务；Mapbox 专注可定制的 WGS84 地图渲染；Cesium 只负责三维场景。

## 稳定入口

Vue 组件只依赖 `planMapProvider`。它现在是 `PlanMapRuntime`，而不是某个地图 SDK 的直接实例。

```text
Vue 业务组件
    ↓
PlanMapRuntime
    ├── PlanMapRenderer       地图/地球渲染、覆盖物、相机、拾取
    ├── PlanPlaceService      POI 搜索、周边搜索、地点详情
    └── PlanRoutingService    路线估算、多路线、途经点路线
```

当前组合仍保持原有行为：

```text
高德模式：AmapRenderer + AmapPlaceService + AmapRoutingService
腾讯模式：TencentRenderer + TencentPlaceService + TencentRoutingService
Google 模式：GoogleRenderer + GooglePlaceService + GoogleRoutingService
```

Cesium 接入后使用：

```text
MapboxRenderer + Amap/Tencent PlaceService + Amap/Tencent RoutingService
CesiumRenderer + Amap/Tencent PlaceService + Amap/Tencent RoutingService
```

## 坐标规则

- 高德、腾讯服务输出 `GCJ02`；Google Maps 输出 `WGS84`；百度来源可标记为 `BD09`。
- Cesium 场景使用 `WGS84`，GCJ-02 路线统一使用精确二分反算后再绘制。
- 持久化地点继续保留自己的 `crs`，不在迁移时批量改写业务数据。
- `PlanMapRuntime` 在服务和渲染边界执行坐标投影。
- 路线 `RouteOption` 和已选择路线快照记录 `crs`。
- `projectMapSceneCoordinates` 创建渲染副本，不修改 Pinia 中的计划数据。

## Cesium Renderer 必须遵守的契约

1. 实现 `PlanMapRenderer`，不要实现或代理 POI、路线查询。
2. `capabilities.coordinateSystem` 声明为 `WGS84`。
3. `capabilities.presentation` 声明为 `globe`。
4. 通过 `mount` 的第三个参数使用地点与路线服务。
5. 只操作传入的场景副本，不回写坐标到计划。
6. `destroy` 必须释放 Viewer、事件监听、Entity、Primitive 和动画时钟。
7. Cesium 与 Mapbox 使用动态导入，不能增加未选择对应引擎时的首屏负担。
8. 产品工具栏与地点详情继续由 Vue 管理，Cesium Widget 不接管现有布局。

## 当前 Cesium 基线

已完成：

1. Cesium 通过动态 import 独立分包，未选择 3D 地球时不会下载主 SDK。
2. Vite 会复制 Workers、Assets、ThirdParty 和 Widgets 到 `cesiumStatic`。
3. 已实现地点全局编号、名称、连续路线、路线信息、聚焦、定位、拾取和路线方案预览。
4. 无 ion Token 时使用内置 Natural Earth 影像和椭球地球。
5. 配置 ion Token 后可以启用 World Imagery、World Terrain 和 OSM 3D Buildings。
6. POI 与路线数据由高德或腾讯提供，并由运行时投影到 WGS84；Google Maps 数据不绘制到 Cesium。

## 后续增强

1. 优化 3D 地球标注避让和路线信息密度。
2. 增加飞机弧线、车辆沿路线移动和镜头巡航。
3. 对地形路线执行高程采样和贴地处理。
4. 增加 3D Tiles 资源管理与按需加载。
5. 针对移动端增加画质档位和自动降级策略。


## Google Maps Provider 基线

1. 使用官方 `@googlemaps/js-api-loader` 动态加载 Maps JavaScript API。
2. 地点搜索和详情使用 Places API (New) 的 `Place.searchByText`、`Place.searchNearby` 与 `fetchFields`。
3. 路线使用 Routes library 的 `Route.computeRoutes`，支持驾车、步行、骑行、公交及多路线方案。
4. 坐标系声明为 `WGS84`；Google 数据只在 Google Maps 渲染器中使用，不跨引擎绘制到 Cesium 或国内地图。
5. API Key、Map ID、语言和区域均由页面配置，并纳入完整配置迁移；源码和构建产物不内置凭据。
6. Map ID 可选；未配置时保留 2D 能力，倾斜视角要求配置矢量 Map ID。


## 首页运行方案选择

首页提供三个彼此独立的选择项：地图渲染器、地点服务和路线服务。用户可以保存一套全局运行方案并应用到所有旅行计划。Google Places 与 Google Routes 只允许与 Google Maps 渲染器组合；Mapbox 和 Cesium 使用高德或腾讯数据服务。未配置的引擎或数据服务会按顺序引导用户完成配置。

## Mapbox Renderer 基线

1. 使用官方 `mapbox-gl` npm 包并动态加载主 SDK 与样式文件。
2. 坐标系为 `WGS84`，通过运行时接收高德或腾讯投影后的地点和路线。
3. 支持普通地图、卫星样式、2D、倾斜视角、地形、3D 建筑、路况、地图拾取、定位、地点标记和完整路线。
4. Mapbox 只作为渲染器接入，第一阶段不把覆盖范围有限的 Mapbox Search 强行作为大陆 POI 服务。
5. Public Access Token、普通样式和卫星样式均由页面配置，并纳入全局和完整迁移。
