/*** Directives and services for responding to idle users in AngularJS. Extended version of ng-idle by HackedByChinese.
* @author Mike Grabski <me@mikegrabski.com>
* @version v1.2.0
* @link https://github.com/mikaba/ng-idle.git
* @license MIT
*/
(function(window, angular, undefined) {
'use strict';
angular.module('ngIdle', ['ngIdle.keepalive', 'ngIdle.idle', 'ngIdle.countdown', 'ngIdle.title', 'ngIdle.localStorage']);
angular.module('ngIdle.keepalive', [])
  .provider('Keepalive', function() {
    var options = {
      http: null,
      interval: 10 * 60
    };

    this.http = function(value) {
      if (!value) throw new Error('Argument must be a string containing a URL, or an object containing the HTTP request configuration.');
      if (angular.isString(value)) {
        value = {
          url: value,
          method: 'GET'
        };
      }

      value.cache = false;

      options.http = value;
    };

    var setInterval = this.interval = function(seconds) {
      seconds = parseInt(seconds);

      if (isNaN(seconds) || seconds <= 0) throw new Error('Interval must be expressed in seconds and be greater than 0.');
      options.interval = seconds;
    };

    this.$get = ['$rootScope', '$log', '$interval', '$http',
      function($rootScope, $log, $interval, $http) {

        var state = {
          ping: null
        };

        function handleResponse(data, status) {
          $rootScope.$broadcast('KeepaliveResponse', data, status);
        }

        function ping() {
          $rootScope.$broadcast('Keepalive');

          if (angular.isObject(options.http)) {
            $http(options.http)
              .success(handleResponse)
              .error(handleResponse);
          }
        }

        return {
          _options: function() {
            return options;
          },
          setInterval: setInterval,
          start: function() {
            $interval.cancel(state.ping);

            state.ping = $interval(ping, options.interval * 1000);
            return state.ping;
          },
          stop: function() {
            $interval.cancel(state.ping);
          },
          ping: function() {
            ping();
          }
        };
      }
    ];
  });

angular.module('ngIdle.idle', ['ngIdle.keepalive', 'ngIdle.localStorage'])
  .provider('Idle', function() {
    var options = {
      idles: {
        default: {
          idle: 20 * 60 // in seconds (default is 20min)
        }
      },
      timeoutTrigger: 'default',
      timeout: 30, // in seconds (default is 30sec)
      autoResume: 'idle', // lets events automatically resume (unsets idle state/resets warning)
      interrupt: 'mousemove keydown DOMMouseScroll mousewheel mousedown touchstart touchmove scroll',
      keepalive: true
    };

    /**
     *  Sets the number of seconds a user can be idle before they are considered timed out.
     *  @param {Number|Boolean} seconds A positive number representing seconds OR 0 or false to disable this feature.
     */
    var setTimeout = this.timeout = function(seconds) {
      if (seconds === false) options.timeout = 0;
      else if (angular.isNumber(seconds) && seconds >= 0) options.timeout = seconds;
      else throw new Error('Timeout must be zero or false to disable the feature, or a positive integer (in seconds) to enable it.');
    };

    this.interrupt = function(events) {
      options.interrupt = events;
    };

    var getIdleOption = function(eventName, create) {
      var option = options.idles[eventName ? eventName : 'default'];
      if (create && !option) {
        option = {};
        options.idles[eventName] = option;
      }
      return option;
    };

    var setIdle = this.idle = function(seconds, eventName) {
      if (seconds <= 0) throw new Error('Idle must be a value in seconds, greater than 0.');

      getIdleOption(eventName, true).idle = seconds;

      for (var idleOptionKey in options.idles) {
        if (options.idles.hasOwnProperty(idleOptionKey)
          && options.idles[idleOptionKey].idle > options.idles[options.timeoutTrigger].idle) {

          options.timeoutTrigger = idleOptionKey;
        }
      }
    };

    this.autoResume = function(value) {
      if (value === true) options.autoResume = 'idle';
      else if (value === false) options.autoResume = 'off';
      else options.autoResume = value;
    };

    this.keepalive = function(enabled) {
      options.keepalive = enabled === true;
    };

    this.$get = ['$interval', '$log', '$rootScope', '$document', 'Keepalive', 'IdleLocalStorage', '$window',
      function($interval, $log, $rootScope, $document, Keepalive, LocalStorage, $window) {
        var state = {
          idle: {},
          timeout: null,
          idling: false,
          running: false,
          countdown: null
        };

        var id = new Date().getTime();

        function startKeepalive() {
          if (!options.keepalive) return;

          if (state.running) Keepalive.ping();

          Keepalive.start();
        }

        function stopKeepalive() {
          if (!options.keepalive) return;

          Keepalive.stop();
        }

        function isEmptyObject(obj) {
          if (!obj || obj === undefined) {
            return true;
          }
          if (Object.getOwnPropertyNames) {
            return !Object.getOwnPropertyNames(obj).length > 0;
          }
          for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
              return false;
            }
          }
          return true;
        }

        function toggleState(idleName) {
          var name = '';
          if (!idleName) {
            state.idling = !state.idling;
          } else {
            // Temporary setting idling state to state of current idleName.
            // At the end we set the overall idleState to the "real"
            // state - since we my have multiple idleNames.
            state.idling = !!state.idle[idleName];
            name += idleName === 'default' ? '' : idleName;
          }
          name += (state.idling ? 'Start' : 'End');

          $rootScope.$broadcast('Idle' + name);

          if (state.idling) {
            stopKeepalive();
            if (options.timeout && options.timeoutTrigger === idleName) {
              state.countdown = options.timeout;
              countdown();
              state.timeout = $interval(countdown, 1000, options.timeout, false);
            }
          } else {
            startKeepalive();
          }

          var intervalPromise = state.idle[idleName ? idleName : 'default'];
          if (intervalPromise) {
            $interval.cancel(intervalPromise);
            delete state.idle[idleName ? idleName : 'default'];
          }

          // Setting the overall idle state if we may be not idling any more.
          // If there are still intervals running we are still idling.
          if (idleName && !state.idling) {
            state.idling = !isEmptyObject(state.idle);
          }
        }

        function countdown() {
          // countdown has expired, so signal timeout
          if (state.countdown <= 0) {
            timeout();
            return;
          }

          // countdown hasn't reached zero, so warn and decrement
          $rootScope.$broadcast('IdleWarn', state.countdown);
          state.countdown--;
        }

        function timeout() {
          stopKeepalive();
          cancelAllIntervalls();

          state.idling = true;
          state.running = false;
          state.countdown = 0;

          $rootScope.$broadcast('IdleTimeout');
        }

        function changeOption(self, fn, value, eventName) {
          var reset = self.running();

          self.unwatch();
          fn(value, eventName);
          if (reset) self.watch();
        }

        function getExpiry() {
          var obj = LocalStorage.get('expiry');

          return obj && obj.time ? new Date(obj.time) : null;
        }

        function setExpiry(date) {
          if (!date) LocalStorage.remove('expiry');
          else LocalStorage.set('expiry', {id: id, time: date});
        }

        function cancelAllIntervalls() {
          for (var key in state.idle) {
            if (state.idle.hasOwnProperty(key)) {
              $interval.cancel(state.idle[key]);
            }
          }
          state.idle = {};
          $interval.cancel(state.timeout);
        }

        function startIdleIntervalls() {
          for (var key in options.idles) {
            if (options.idles.hasOwnProperty(key)) {
              state.idle[key] = $interval(toggleState, options.idles[key].idle * 1000, 0, false, key)
            }
          }
        }

        var svc = {
          _options: function() {
            return options;
          },
          _getNow: function() {
            return new Date();
          },
          getIdle: function(eventName){
            return getIdleOption(eventName) ? getIdleOption(eventName).idle : undefined;
          },
          getTimeout: function(){
            return options.timeout;
          },
          setIdle: function(seconds, eventName) {
            changeOption(this, setIdle, seconds, eventName);
          },
          setTimeout: function(seconds) {
            changeOption(this, setTimeout, seconds);
          },
          isExpired: function() {
            var expiry = getExpiry();
            return expiry !== null && expiry <= this._getNow();
          },
          running: function() {
            return state.running;
          },
          idling: function() {
            return state.idling;
          },
          watch: function(noExpiryUpdate) {
            cancelAllIntervalls();

            // calculate the absolute expiry date, as added insurance against a browser sleeping or paused in the background
            var timeout = !options.timeout ? 0 : options.timeout;
            if (!noExpiryUpdate) setExpiry(new Date(new Date().getTime() + ((getIdleOption().idle + timeout) * 1000)));


            if (state.idling) toggleState(); // clears the idle state if currently idling
            else if (!state.running) startKeepalive(); // if about to run, start keep alive

            state.running = true;

            startIdleIntervalls();
          },
          unwatch: function() {
            cancelAllIntervalls();

            state.idling = false;
            state.running = false;
            setExpiry(null);

            stopKeepalive();
          },
          interrupt: function(noExpiryUpdate) {
            if (!state.running) return;

            if (options.timeout && this.isExpired()) {
              timeout();
              return;
            }

            // note: you can no longer auto resume once we exceed the expiry; you will reset state by calling watch() manually
            if (options.autoResume === 'idle' || (options.autoResume === 'notIdle' && !state.idling)) this.watch(noExpiryUpdate);
          }
        };

        $document.find('html').on(options.interrupt, function(event) {
          if (event.type === 'mousemove' && event.originalEvent && event.originalEvent.movementX === 0 && event.originalEvent.movementY === 0) {
            return; // Fix for Chrome desktop notifications, triggering mousemove event.
          }

          /*
            note:
              webkit fires fake mousemove events when the user has done nothing, so the idle will never time out while the cursor is over the webpage
              Original webkit bug report which caused this issue:
                https://bugs.webkit.org/show_bug.cgi?id=17052
              Chromium bug reports for issue:
                https://code.google.com/p/chromium/issues/detail?id=5598
                https://code.google.com/p/chromium/issues/detail?id=241476
                https://code.google.com/p/chromium/issues/detail?id=317007
          */
          if (event.type !== 'mousemove' || angular.isUndefined(event.movementX) || (event.movementX || event.movementY)) {
            svc.interrupt();
          }
        });

        var wrap = function(event) {
          if (event.key === 'ngIdle.expiry' && event.newValue && event.newValue !== event.oldValue) {
            var val = angular.fromJson(event.newValue);
            if (val.id === id) return;
            svc.interrupt(true);
          }
        };

        if ($window.addEventListener) $window.addEventListener('storage', wrap, false);
        else $window.attachEvent('onstorage', wrap);

        return svc;
      }
    ];
  });

angular.module('ngIdle.countdown', ['ngIdle.idle'])
  .directive('idleCountdown', ['Idle', function(Idle) {
    return {
      restrict: 'A',
      scope: {
        value: '=idleCountdown'
      },
      link: function($scope) {
        // Initialize the scope's value to the configured timeout.
        $scope.value = Idle.getTimeout();

        $scope.$on('IdleWarn', function(e, countdown) {
          $scope.$evalAsync(function() {
            $scope.value = countdown;
          });
        });

        $scope.$on('IdleTimeout', function() {
          $scope.$evalAsync(function() {
            $scope.value = 0;
          });
        });
      }
    };
  }]);

angular.module('ngIdle.title', [])
  .provider('Title', function() {
    var options = {
      enabled: true
    };

    var setEnabled = this.enabled = function(enabled) {
      options.enabled = enabled === true;
    };

    function padLeft(nr, n, str){
      return new Array(n-String(nr).length+1).join(str||'0')+nr;
    }

    this.$get = ['$document', '$interpolate', function($document, $interpolate) {
      var state = {
        original: null,
        idle: '{{minutes}}:{{seconds}} until your session times out!',
        timedout: 'Your session has expired.'
      };

      return {
        setEnabled: setEnabled,
        isEnabled: function() {
          return options.enabled;
        },
        original: function(val) {
          if (angular.isUndefined(val)) return state.original;

          state.original = val;
        },
        store: function(overwrite) {
          if (overwrite || !state.original) state.original = this.value();
        },
        value: function(val) {
          if (angular.isUndefined(val)) return $document[0].title;

          $document[0].title = val;
        },
        idleMessage: function(val) {
          if (angular.isUndefined(val)) return state.idle;

          state.idle = val;
        },
        timedOutMessage: function(val) {
          if (angular.isUndefined(val)) return state.timedout;

          state.timedout = val;
        },
        setAsIdle: function(countdown) {
          this.store();

          var remaining = { totalSeconds: countdown };
          remaining.minutes = Math.floor(countdown/60);
          remaining.seconds = padLeft(countdown - remaining.minutes * 60, 2);

          this.value($interpolate(this.idleMessage())(remaining));
        },
        setAsTimedOut: function() {
          this.store();

          this.value(this.timedOutMessage());
        },
        restore: function() {
          if (this.original()) this.value(this.original());
        }
      };
    }];
  })
  .directive('title', ['Title', function(Title) {
      return {
        restrict: 'E',
        link: function($scope, $element, $attr) {
          if (!Title.isEnabled() || $attr.idleDisabled) return;

          Title.store(true);

          $scope.$on('IdleStart', function() {
            Title.original($element[0].innerText);
          });

          $scope.$on('IdleWarn', function(e, countdown) {
            Title.setAsIdle(countdown);
          });

          $scope.$on('IdleEnd', function() {
            Title.restore();
          });

          $scope.$on('IdleTimeout', function() {
            Title.setAsTimedOut();
          });
        }
      };
  }]);

angular.module('ngIdle.localStorage', [])
  .provider('IdleStorageAccessor', function() {

      var storageGetter = function($injector) {
          var $window = $injector.get('$window');
          return $window.localStorage;
      };

      /**
       * Sets a function to retrieve the storage where Idle will save it's expiry.
       * The function will be called with $injector as the only parameter.
       * Default is local storage.
       * @param getterFunction
       */
      this.setStorageGetter = function(getterFunction) {
          if (typeof getterFunction === 'function') {
              storageGetter = getterFunction;
          }
      };

      this.$get = ['$injector', function($injector) {
          return {
              get: function() {
                  return storageGetter($injector);
              }
          }
      }];
  })
  .service('IdleLocalStorage', ['IdleStorageAccessor', function(IdleStorageAccessor) {
    function AlternativeStorage() {
      var storageMap = {};

      this.setItem = function (key, value) {
          storageMap[key] = value;
      };

      this.getItem = function (key) {
          if(typeof storageMap[key] !== 'undefined' ) {
              return storageMap[key];
          }
          return null;
      };

      this.removeItem = function (key) {
          storageMap[key] = undefined;
      };
    }

    function getStorage() {
       try {
          var s = IdleStorageAccessor.get();
          s.setItem('ngIdleStorage', '');
          s.removeItem('ngIdleStorage');

          return s;
       } catch(err) {
          return new AlternativeStorage();
       }
    }

    // Safari, in Private Browsing Mode, looks like it supports localStorage but all calls to setItem
    // throw QuotaExceededError. We're going to detect this and just silently drop any calls to setItem
    // to avoid the entire page breaking, without having to do a check at each usage of Storage.
    var storage = getStorage();

    return {
      set: function(key, value) {
        storage.setItem('ngIdle.'+key, angular.toJson(value));
      },
      get: function(key) {
        return angular.fromJson(storage.getItem('ngIdle.'+key));
      },
      remove: function(key) {
        storage.removeItem('ngIdle.'+key);
      },
      _wrapped: function() {
        return storage;
      }
    };
}]);

})(window, window.angular);