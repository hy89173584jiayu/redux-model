import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { Dispatch, Middleware, MiddlewareAPI } from 'redux';
import { HTTP_STATUS_CODE, METHOD } from './util';

interface FailTransform {
  httpStatus?: HTTP_STATUS_CODE;
  errorMessage?: string;
  businessCode?: string;
}

type MixedReturn = MiddlewareReturnObject | RequestAction;

export const createRequestMiddleware = <State extends AnyObject>(config: {
  id: string;
  baseUrl: string;
  axiosConfig?: AxiosRequestConfig;
  onInit?: (api: MiddlewareAPI<Dispatch, State>, action: RequestAction) => void;
  getHeaders: (api: MiddlewareAPI<Dispatch, State>) => AnyObject;
  onFail: (error: AxiosError, transform: FailTransform) => void;
  onShowSuccess: (message: string) => void;
  onShowError: (message: string) => void;
}) => {
  const httpHandle = axios.create({
    baseURL: config.baseUrl,
    timeout: 20000,
    withCredentials: false,
    responseType: 'json',
    ...config.axiosConfig,
  });

  const middleware: Middleware<{}, State> = (api) => (next) => (action: RequestAction): MixedReturn => {
    if (action.middleware !== config.id) {
      return next(action);
    }

    if (config.onInit) {
      config.onInit(api, action);
    }

    const { prepare, success, fail } = action.type;
    const source = axios.CancelToken.source();
    const requestOptions: AxiosRequestConfig = {
      url: action.uri,
      params: action.query,
      cancelToken: source.token,
      method: action.method,
      ...action.requestOptions,
      headers: {
        ...config.getHeaders(api),
        ...action.requestOptions.headers,
      },
    };

    if ([METHOD.post, METHOD.put, METHOD.delete, METHOD.patch].includes(action.method)) {
      requestOptions.data = action.body;
    }

    next({ ...action, type: prepare });
    const promise = httpHandle.request(requestOptions)
        .then((response) => {
          const okResponse: ResponseAction = {
            ...action,
            payload: action.payload,
            type: success,
            response: response.data,
          };

          next(okResponse);

          if (action.successText) {
            config.onShowSuccess(action.successText);
          }

          return Promise.resolve(okResponse);
        })
        .catch((error: AxiosError) => {
          const isCancel = axios.isCancel(error);
          let errorMessage;
          let httpStatus;
          let businessCode;

          if (isCancel) {
            errorMessage = error.message || '请求已被主动取消';
          } else if (error.request && error.response) {
            const transform: FailTransform = {};

            config.onFail(error, transform);

            errorMessage = transform.errorMessage || '接口请求时捕获到异常';
            httpStatus = transform.httpStatus;
            businessCode = transform.businessCode;
          } else {
            errorMessage = error.message || '接口请求时捕获到异常';
          }

          if (/^timeout\sof\s\d+m?s\sexceeded$/i.test(errorMessage)) {
            errorMessage = '网络繁忙，请求超时';
          }

          const errorResponse: ResponseAction = {
            ...action,
            payload: action.payload,
            response: error.response || {},
            type: fail,
            errorMessage,
            httpStatus,
            businessCode,
          };

          next(errorResponse);

          if (!isCancel) {
            let showError: boolean;

            if (typeof action.hideError === 'boolean') {
              showError = !action.hideError;
            } else {
              showError = !action.hideError(errorResponse);
            }

            if (showError) {
              config.onShowError(errorMessage);
            }
          }

          return Promise.reject(errorResponse);
        });

    return {
      promise,
      cancel: source.cancel,
    };
  };

  return middleware;
};