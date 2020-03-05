/*
 | Copyright 2018 Esri
 |
 | Licensed under the Apache License, Version 2.0 (the "License");
 | you may not use this file except in compliance with the License.
 | You may obtain a copy of the License at
 |
 |    http://www.apache.org/licenses/LICENSE-2.0
 |
 | Unless required by applicable law or agreed to in writing, software
 | distributed under the License is distributed on an "AS IS" BASIS,
 | WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 | See the License for the specific language governing permissions and
 | limitations under the License.
 */

import * as common from "@esri/solution-common";

/**
 * The portion of a Webmap URL between the server and the map id.
 * @protected
 */
const WEBMAP_APP_URL_PART: string = "/home/webmap/viewer.html?webmap=";

// ------------------------------------------------------------------------------------------------------------------ //

/**
 * Converts an AGOL webmap item to a template.
 *
 * @param itemTemplate Template for the webmap item
 * @param authentication credentials for the request
 * @return Template for the solution item that contains key details for item reconstruction
 */
export function convertItemToTemplate(
  itemTemplate: common.IItemTemplate,
  authentication: common.UserSession
): Promise<common.IItemTemplate> {
  return new Promise<common.IItemTemplate>((resolve, reject) => {
    // Templatize the app URL
    itemTemplate.item.url =
      common.PLACEHOLDER_SERVER_NAME +
      WEBMAP_APP_URL_PART +
      itemTemplate.item.id; // templatized id

    // Extract dependencies
    _extractDependencies(itemTemplate, authentication).then(
      (results: any) => {
        itemTemplate.dependencies = results.dependencies;

        // Templatize the map layer ids after we've extracted them as dependencies
        if (itemTemplate.data) {
          _templatizeWebmapLayerIdsAndUrls(
            itemTemplate.data.operationalLayers,
            results.urlHash
          );
          _templatizeWebmapLayerIdsAndUrls(
            itemTemplate.data.tables,
            results.urlHash
          );
        }

        resolve(itemTemplate);
      },
      e => reject(common.fail(e))
    );
  });
}

/**
 * Gets the ids of the dependencies of an AGOL webmap item.
 *
 * @param itemTemplate A webmap item whose dependencies are sought
 * @param authentication Credentials for any requests
 * @return List of dependencies ids and url/itemId hash
 * @protected
 */
export function _extractDependencies(
  itemTemplate: common.IItemTemplate,
  authentication: common.UserSession
): Promise<any> {
  return new Promise<any>((resolve, reject) => {
    const dependencies: string[] = [];
    if (itemTemplate.data) {
      const layers: any[] = itemTemplate.data.operationalLayers || [];
      const tables: any[] = itemTemplate.data.tables || [];
      const layersAndTables: any[] = layers.concat(tables);
      _getLayerIds(layersAndTables, dependencies, authentication).then(
        results => {
          resolve(results);
        },
        e => reject(common.fail(e))
      );
    } else {
      resolve({
        dependencies: dependencies,
        urlHash: {}
      });
    }
  });
}

/**
 * Extracts the AGOL itemId for each layer or table object in a list using the url.
 *
 * @param layerList List of map layers or tables
 * @param dependencies Current list of dependencies
 * @param authentication Credentials for any requests
 * @return List of dependencies ids and url/itemId hash
 * @protected
 */
export function _getLayerIds(
  layerList: any[],
  dependencies: string[],
  authentication: common.UserSession
): Promise<any> {
  return new Promise<any>((resolve, reject) => {
    const urlHash: any = {};

    const options: any = {
      f: "json",
      authentication: authentication
    };
    const layerPromises: Array<Promise<any>> = [];
    const layers: any[] = layerList.filter(layer => {
      if (layer.url) {
        // use url to find serviceItemId
        layerPromises.push(common.rest_request(layer.url, options));
        return true;
      } else {
        return false;
      }
    });

    if (layerPromises.length > 0) {
      Promise.all(layerPromises).then(
        serviceResponses => {
          const idChecks: any = {};
          const itemOwnerPromises: Array<Promise<any>> = serviceResponses.map(
            serviceResponse => {
              // avoid redundant id checks when we have a layer with sub layers referenced in the map
              const id: string = common.getProp(
                serviceResponse,
                "serviceItemId"
              );
              if (id && Object.keys(idChecks).indexOf(id) < 0) {
                idChecks[id] = common.isUserItemAdmin(
                  serviceResponse.serviceItemId,
                  authentication
                );
              }
              return id ? idChecks[id] : Promise.resolve(false);
            }
          );

          if (itemOwnerPromises.length > 0) {
            Promise.all(itemOwnerPromises).then(
              itemOwnerResponses => {
                itemOwnerResponses.forEach((canTemplatize, i) => {
                  const id: string = serviceResponses[i].serviceItemId;
                  if (dependencies.indexOf(id) < 0) {
                    dependencies.push(id);
                  }
                  urlHash[layers[i].url] = {
                    id: id,
                    canTemplatize: canTemplatize
                  };
                });
                resolve({
                  dependencies: dependencies,
                  urlHash: urlHash
                });
              },
              e => reject(common.fail(e))
            );
          } else {
            resolve({
              dependencies: dependencies,
              urlHash: urlHash
            });
          }
        },
        e => reject(common.fail(e))
      );
    } else {
      resolve({
        dependencies: dependencies,
        urlHash: urlHash
      });
    }
  });
}

/**
 * Templatizes the url and item id for layers or tables within the webmap.
 *
 * @param layerList List of map layers or tables
 * @param urlHash Lookup object for analysis layers
 * @return void
 * @protected
 */
export function _templatizeWebmapLayerIdsAndUrls(
  layerList = [] as any[],
  urlHash: any
): void {
  layerList.forEach((layer: any) => {
    if (layer.url) {
      const layerId = layer.url.substr(
        (layer.url as string).lastIndexOf("/") + 1
      );
      const hashLayer: any =
        Object.keys(urlHash).indexOf(layer.url) > -1
          ? urlHash[layer.url]
          : undefined;
      if (hashLayer && hashLayer.canTemplatize) {
        const id: string = hashLayer.id;
        layer.url = common.templatizeTerm(id, id, ".layer" + layerId + ".url");
        layer.itemId = common.templatizeTerm(
          id,
          id,
          ".layer" + layerId + ".itemId"
        );
      }
    }
  });
}

/**
 * Templatize field references.
 *
 * @param solutionTemplate The solution item template
 * @param datasourceInfos A list of datasource info objects that contain key values to templatize field references
 * @returns The solutionTemplate with templatized field references
 */
export function postProcessFieldReferences(
  solutionTemplate: common.IItemTemplate,
  datasourceInfos: common.IDatasourceInfo[]
): common.IItemTemplate {
  const paths: string[] = [
    "data.operationalLayers",
    "data.tables",
    "data.applicationProperties.viewing.search.layers"
  ];
  paths.forEach(p => _templatizeProperty(solutionTemplate, datasourceInfos, p));
  return solutionTemplate;
}

/**
 * Templatize field references.
 *
 * @param solutionTemplate The solution item template
 * @param datasourceInfos A list of datasource info objects that contain key values to templatize field references
 * @param path A string path to the object property to templatize
 */
export function _templatizeProperty(
  solutionTemplate: common.IItemTemplate,
  datasourceInfos: common.IDatasourceInfo[],
  path: string
): void {
  const objs: any[] = common.getProp(solutionTemplate, path);
  if (objs) {
    common.setProp(solutionTemplate, path, _templatize(objs, datasourceInfos));
  }
}

/**
 * Templatize field references.
 *
 * @param objs Can be operationalLayers or tables or appProperties search layers
 * @param datasourceInfos A list of datasource info objects that contain key values to templatize field references
 * @returns updated instances of the objects
 */
export function _templatize(
  objs: any[],
  datasourceInfos: common.IDatasourceInfo[]
): any[] {
  objs.forEach(obj => {
    const ds: common.IDatasourceInfo = _getDatasourceInfo(obj, datasourceInfos);
    if (ds) {
      const fieldNames: string[] = ds.fields.map(f => f.name);

      common._templatizePopupInfo(obj, ds, ds.basePath, ds.itemId, fieldNames);

      common._templatizeDefinitionEditor(obj, ds.basePath, fieldNames);

      if (obj.layerDefinition) {
        common._templatizeDrawingInfo(
          obj.layerDefinition,
          ds.basePath,
          fieldNames
        );

        common._templatizeDefinitionExpression(
          obj.layerDefinition,
          ds.basePath,
          fieldNames
        );
      }

      // used for applicationProperties search layers
      const fieldName: any = common.getProp(obj, "field.name");
      if (fieldName) {
        common.setProp(
          obj,
          "field.name",
          common._templatizeFieldName(fieldName, obj, ds.itemId, ds.basePath)
        );
      }
    }
  });

  return objs;
}

/**
 * Get datasourceInfo by map layer id
 *
 * @param obj Can be operationalLayer or table or appProperties search layer
 * @param datasourceInfos A list of datasource info objects that contain key values to templatize field references
 * @returns datasourceInfo for the given object id
 */
export function _getDatasourceInfo(
  obj: any,
  datasourceInfos: common.IDatasourceInfo[]
): any {
  let datasourceInfo: any;
  datasourceInfos.some(ds => {
    if (ds.ids.indexOf(obj.id) > -1) {
      datasourceInfo = ds;
      return true;
    } else {
      return false;
    }
  });
  return datasourceInfo;
}
